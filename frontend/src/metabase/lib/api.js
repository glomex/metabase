/* @flow weak */

import querystring from "querystring";

import EventEmitter from "events";

type TransformFn = (o: any) => any;

export type Options = {
  noEvent?: boolean,
  transformResponse?: TransformFn,
  cancelled?: Promise<any>,
  raw?: { [key: string]: boolean },
};
export type Data = {
  [key: string]: any,
};

const DEFAULT_OPTIONS: Options = {
  noEvent: false,
  transformResponse: o => o,
  raw: {},
};

export type APIMethod = (d?: Data, o?: Options) => Promise<any>;
export type APICreator = (t: string, o?: Options | TransformFn) => APIMethod;

class Api extends EventEmitter {
  basename: "";

  GET: APICreator;
  GET_WITH_XHR: APICreator;
  POST: APICreator;
  PUT: APICreator;
  DELETE: APICreator;

  constructor() {
    super();
    this.GET = this._makeMethod("GET");
    this.GET_WITH_XHR = this._makeMethod("GET_WITH_XHR");
    this.DELETE = this._makeMethod("DELETE");
    this.POST = this._makeMethod("POST", true);
    this.PUT = this._makeMethod("PUT", true);
  }

  _makeMethod(method: string, hasBody: boolean = false): APICreator {
    return (
      urlTemplate: string,
      methodOptions?: Options | TransformFn = {},
    ) => {
      if (typeof methodOptions === "function") {
        methodOptions = { transformResponse: methodOptions };
      }
      const defaultOptions = { ...DEFAULT_OPTIONS, ...methodOptions };
      return (data?: Data, invocationOptions?: Options = {}): Promise<any> => {
        const options: Options = { ...defaultOptions, ...invocationOptions };
        let url = urlTemplate;
        data = { ...data };
        for (let tag of url.match(/:\w+/g) || []) {
          const paramName = tag.slice(1);
          let value = data[paramName];
          delete data[paramName];
          if (value === undefined) {
            console.warn("Warning: calling", method, "without", tag);
            value = "";
          }
          if (!options.raw || !options.raw[paramName]) {
            value = encodeURIComponent(value);
          }
          url = url.replace(tag, value);
        }
        // remove undefined
        for (const name in data) {
          if (data[name] === undefined) {
            delete data[name];
          }
        }

        let headers: { [key: string]: string } = {
          Accept: "application/json",
        };

        let body;
        if (hasBody) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(data);
        } else {
          let qs = querystring.stringify(data);
          if (qs) {
            url += (url.indexOf("?") >= 0 ? "&" : "?") + qs;
          }
        }

        return this._makeRequest(method, url, headers, body, data, options);
      };
    };
  }

  makeCancelable = (promise) => {
    let hasCanceled_ = false;

    const wrappedPromise = new Promise((resolve, reject) => {
      promise.then((val) => hasCanceled_ ? reject({isCanceled: true}) : resolve(val));
      promise.catch((error) => hasCanceled_ ? reject({isCanceled: true}) : reject(error));
    });

    return {
      promise: wrappedPromise,
      cancel() {
        hasCanceled_ = true;
      },
    };
  };

  // TODO Atte Keinänen 6/26/17: Replacing this with isomorphic-fetch could simplify the implementation
  _makeRequest(method, url, headers, body, data, options) {
    let reqMethod = method;
    if (method === 'GET_WITH_XHR') {
      reqMethod = 'GET';
    }
    let xhr = new XMLHttpRequest();
    let promise = new Promise((resolve, reject) => {
      let isCancelled = false;
      xhr.open(reqMethod, this.basename + url);
      for (let headerName in headers) {
        xhr.setRequestHeader(headerName, headers[headerName]);
      }
      xhr.onreadystatechange = () => {
        // $FlowFixMe
        if (xhr.readyState === XMLHttpRequest.DONE) {
          let body = xhr.responseText;
          try {
            body = JSON.parse(body);
          } catch (e) {}
          if (xhr.status >= 200 && xhr.status <= 299) {
            if (options.transformResponse) {
              body = options.transformResponse(body, { data });
            }
            resolve(body);
          } else {
            reject({
              status: xhr.status,
              data: body,
              isCancelled: isCancelled,
            });
          }
          if (!options.noEvent) {
            this.emit(xhr.status, url);
          }
        }
      };
      xhr.send(body);

      if (options.cancelled) {
        options.cancelled.then(() => {
          isCancelled = true;
          xhr.abort();
      });
      }
    });
    if (method === 'GET_WITH_XHR') {
      return {
        promise: this.makeCancelable(promise),
        xhr
      }
    }

    return promise;
  }
}

const instance = new Api();

export default instance;
export const { GET, POST, PUT, DELETE, GET_WITH_XHR } = instance;

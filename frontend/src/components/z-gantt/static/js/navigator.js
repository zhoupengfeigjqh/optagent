import Highcharts from './highcharts-gantt.js';

;(function (factory) {
  factory(Highcharts, Highcharts.Chart, Highcharts.Axis, Highcharts.Color);
})(
  (
    __WEBPACK_EXTERNAL_MODULE__944__,
    __WEBPACK_EXTERNAL_MODULE__960__,
    __WEBPACK_EXTERNAL_MODULE__532__,
    __WEBPACK_EXTERNAL_MODULE__620__,
  ) => {
    return  (() => {
       'use strict';
       var __webpack_modules__ = {
         512:  (module) => {
          // v11 兼容垫片：highcharts-gantt.js v11.1.0 没有将 SeriesRegistry 暴露到 window.Highcharts
          // v12 的 navigator.js 通过 destructure { seriesTypes } 引用它，我们提供一个最小兼容对象
          // 注意：v11 中 gantt 图表自带内置 navigator，无需此模块
          var __v11_compat_series_types__ =
            (typeof window !== 'undefined' &&
              window.Highcharts &&
              window.Highcharts.seriesTypes) ||
            {};
          module.exports = { seriesTypes: __v11_compat_series_types__ };

        },

         532:  (module) => {
          module.exports = __WEBPACK_EXTERNAL_MODULE__532__;

        },

         608:  (module) => {
          // v11 兼容垫片：highcharts-gantt.js v11.1.0 没有将 RendererRegistry 暴露到 window.Highcharts
          // 我们 mock 一个最小的兼容实现：返回的 symbols 会被 navigator 模块扩展为 navigator 专属 symbols
          var __v11_compat_renderer_symbols__ =
            (typeof window !== 'undefined' &&
              window.__hc_navigator_renderer_symbols__) ||
            (window.__hc_navigator_renderer_symbols__ = {});
          module.exports = {
            getRendererType: function () {
              return {
                prototype: { symbols: __v11_compat_renderer_symbols__ },
              };
            },
          };

        },

         620:  (module) => {
          module.exports = __WEBPACK_EXTERNAL_MODULE__620__;

        },

         944:  (module) => {
          module.exports = __WEBPACK_EXTERNAL_MODULE__944__;

        },

         960:  (module) => {
          module.exports = __WEBPACK_EXTERNAL_MODULE__960__;

        },

      };
       var __webpack_module_cache__ = {};
       function __webpack_require__(moduleId) {
         var cachedModule = __webpack_module_cache__[moduleId];
         if (cachedModule !== undefined) {
           return cachedModule.exports;
        }
         var module = (__webpack_module_cache__[moduleId] = {
           exports: {},
        });
         __webpack_modules__[moduleId](
          module,
          module.exports,
          __webpack_require__,
        );
         return module.exports;
      }
       (() => {
         __webpack_require__.n = (module) => {
           var getter =
            module && module.__esModule
              ?  () => module['default']
              :  () => module;
           __webpack_require__.d(getter, { a: getter });
           return getter;
        };
      })();
       (() => {
         __webpack_require__.d = (exports, definition) => {
           for (var key in definition) {
             if (
              __webpack_require__.o(definition, key) &&
              !__webpack_require__.o(exports, key)
            ) {
               Object.defineProperty(exports, key, {
                enumerable: true,
                get: definition[key],
              });
            }
          }
        };
      })();
       (() => {
         __webpack_require__.o = (obj, prop) =>
          Object.prototype.hasOwnProperty.call(obj, prop);
      })();
      var __webpack_exports__ = {};

      __webpack_require__.d(__webpack_exports__, {
        default: () =>  navigator_src,
      });

      var highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_ =
        __webpack_require__(944);
      var highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default =
         __webpack_require__.n(
          highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_,
        );
      var highcharts_Chart_commonjs_highcharts_Chart_commonjs2_highcharts_Chart_root_Highcharts_Chart_ =
        __webpack_require__(960);
      var highcharts_Chart_commonjs_highcharts_Chart_commonjs2_highcharts_Chart_root_Highcharts_Chart_default =
         __webpack_require__.n(
          highcharts_Chart_commonjs_highcharts_Chart_commonjs2_highcharts_Chart_root_Highcharts_Chart_,
        );
      var highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_ =
        __webpack_require__(532);
      var highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_default =
         __webpack_require__.n(
          highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_,
        );

      const { doc, win } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();
      function addEvent(el, type, fn, options = {}) {
        const owner = (typeof el === 'function' && el.prototype) || el;
        if (!Object.hasOwnProperty.call(owner, 'hcEvents')) {
          owner.hcEvents = {};
        }
        const events = owner.hcEvents;
        // Allow click events added to points, otherwise they will be prevented by
        if (
          highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
            .Point &&
          el instanceof
            highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
              .Point &&
          el.series &&
          el.series.chart
        ) {
          el.series.chart.runTrackerClick = true;
        }
        const addEventListener = el.addEventListener;
        if (addEventListener) {
          addEventListener.call(
            el,
            type,
            fn,
            highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
              .supportsPassiveEvents
              ? {
                  passive:
                    options.passive === void 0
                      ? type.indexOf('touch') !== -1
                      : options.passive,
                  capture: false,
                }
              : false,
          );
        }
        if (!events[type]) {
          events[type] = [];
        }
        const eventObject = {
          fn,
          order: typeof options.order === 'number' ? options.order : Infinity,
        };
        events[type].push(eventObject);
        events[type].sort((a, b) => a.order - b.order);
        return function () {
          removeEvent(el, type, fn);
        };
      }
      function arrayMin(data) {
        let i = data.length,
          min = data[0];
        while (i--) {
          if (data[i] < min) {
            min = data[i];
          }
        }
        return min;
      }
      function arrayMax(data) {
        let i = data.length,
          max = data[0];
        while (i--) {
          if (data[i] > max) {
            max = data[i];
          }
        }
        return max;
      }
      function attr(elem, keyOrAttribs, value) {
        const isGetter = isString(keyOrAttribs) && !defined(value);
        let ret;
        const attrSingle = (value, key) => {
          if (defined(value)) {
            elem.setAttribute(key, value);
          } else if (isGetter) {
            ret = elem.getAttribute(key);
            if (!ret && key === 'class') {
              ret = elem.getAttribute(key + 'Name');
            }
          } else {
            elem.removeAttribute(key);
          }
        };
        if (isString(keyOrAttribs)) {
          attrSingle(value, keyOrAttribs);
        } else {
          objectEach(keyOrAttribs, attrSingle);
        }
        return ret;
      }
      function clamp(value, min, max) {
        return value > min ? (value < max ? value : max) : min;
      }
      function correctFloat(num, prec) {
        return num > 1e14 ? num : parseFloat(num.toPrecision(prec || 14));
      }
      function createElement(tag, attribs, styles, parent, nopad) {
        const el = doc.createElement(tag);
        if (attribs) {
          extend(el, attribs);
        }
        if (nopad) {
          css(el, { padding: '0', border: 'none', margin: '0' });
        }
        if (styles) {
          css(el, styles);
        }
        if (parent) {
          parent.appendChild(el);
        }
        return el;
      }
      function crisp(value, lineWidth = 0, inverted) {
        const mod = (lineWidth % 2) / 2,
          inverter = inverted ? -1 : 1;
        return (Math.round(value * inverter - mod) + mod) * inverter;
      }
      function css(el, styles) {
        extend(el.style, styles);
      }
      function defined(obj) {
        return typeof obj !== 'undefined' && obj !== null;
      }
      function destroyObjectProperties(obj, except, destructablesOnly) {
        objectEach(obj, function (val, n) {
          if (val !== except && val?.destroy) {
            val.destroy();
          }
          if (val?.destroy || !destructablesOnly) {
            delete obj[n];
          }
        });
      }
      function discardElement(element) {
        element?.parentElement?.removeChild(element);
      }
      // eslint-disable-next-line valid-jsdoc
      /**
       * Return the deep difference between two objects. It can either return the new
       * properties, or optionally return the old values of new properties.
       * @internal
       */
      function diffObjects(newer, older, keepOlder, collectionsWithUpdate) {
        const ret = {};
        function diff(newer, older, ret, depth) {
          const keeper = keepOlder ? older : newer;
          objectEach(newer, function (newerVal, key) {
            if (
              !depth &&
              collectionsWithUpdate &&
              collectionsWithUpdate.indexOf(key) > -1 &&
              older[key]
            ) {
              newerVal = splat(newerVal);
              ret[key] = [];
              for (
                let i = 0;
                i < Math.max(newerVal.length, older[key].length);
                i++
              ) {
                if (older[key][i]) {
                  if (newerVal[i] === void 0) {
                    ret[key][i] = older[key][i];
                  } else {
                    ret[key][i] = {};
                    diff(newerVal[i], older[key][i], ret[key][i], depth + 1);
                  }
                }
              }
            } else if (
              isObject(newerVal, true) &&
              !newerVal.nodeType
            ) {
              ret[key] = isArray(newerVal) ? [] : {};
              diff(newerVal, older[key] || {}, ret[key], depth + 1);
              if (
                Object.keys(ret[key]).length === 0 &&
                !(key === 'colorAxis' && depth === 0)
              ) {
                delete ret[key];
              }
            } else if (
              newer[key] !== older[key] ||
              (key in newer && !(key in older))
            ) {
              if (key !== '__proto__' && key !== 'constructor') {
                ret[key] = keeper[key];
              }
            }
          });
        }
        diff(newer, older, ret, 0);
        return ret;
      }
      function erase(arr, item) {
        let i = arr.length;
        while (i--) {
          if (arr[i] === item) {
            arr.splice(i, 1);
            break;
          }
        }
      }
      function extend(a, b) {
        let n;
        if (!a) {
          a = {};
        }
        for (n in b) {
          // eslint-disable-line guard-for-in
          a[n] = b[n];
        }
        return a;
      }
      // eslint-disable-next-line valid-jsdoc
      function extendClass(parent, members) {
        const obj = function () {};
        obj.prototype = new parent(); // eslint-disable-line new-cap
        extend(obj.prototype, members);
        return obj;
      }
      function fireEvent(el, type, eventArguments, defaultFunction) {
        eventArguments = eventArguments || {};
        if (
          doc?.createEvent &&
          (el.dispatchEvent ||
            (el.fireEvent &&
              el !==
                highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()))
        ) {
          const e = doc.createEvent('Events');
          e.initEvent(type, true, true);
          eventArguments = extend(e, eventArguments);
          if (el.dispatchEvent) {
            el.dispatchEvent(eventArguments);
          } else {
            el.fireEvent(type, eventArguments);
          }
        } else if (el.hcEvents) {
          if (!eventArguments.target) {
            extend(eventArguments, {
              preventDefault: function () {
                eventArguments.defaultPrevented = true;
              },
              target: el,
              type: type,
            });
          }
          const events = [];
          let object = el;
          let multilevel = false;
          while (object.hcEvents) {
            if (
              Object.hasOwnProperty.call(object, 'hcEvents') &&
              object.hcEvents[type]
            ) {
              if (events.length) {
                multilevel = true;
              }
              events.unshift.apply(events, object.hcEvents[type]);
            }
            object = Object.getPrototypeOf(object);
          }
          if (multilevel) {
            events.sort((a, b) => a.order - b.order);
          }
          events.forEach((obj) => {
            if (obj.fn.call(el, eventArguments, el) === false) {
              eventArguments.preventDefault();
            }
          });
        }
        if (defaultFunction && !eventArguments.defaultPrevented) {
          defaultFunction.call(el, eventArguments);
        }
      }
      /**
       * Convenience function to get the align factor, used several places for
       * computing positions
       * @internal
       */
      const getAlignFactor = (align = '') =>
        ({
          center: 0.5,
          right: 1,
          middle: 0.5,
          bottom: 1,
        })[align] || 0;
      function getClosestDistance(arrays, onError) {
        const allowNegative = !onError;
        let closest, loopLength, distance, i;
        arrays.forEach((xData) => {
          if (xData.length > 1) {
            loopLength = xData.length - 1;
            for (i = loopLength; i > 0; i--) {
              distance = xData[i] - xData[i - 1];
              if (distance < 0 && !allowNegative) {
                onError?.();
                onError = void 0;
              } else if (
                distance &&
                (typeof closest === 'undefined' || distance < closest)
              ) {
                closest = distance;
              }
            }
          }
        });
        return closest;
      }
      function getMagnitude(num) {
        return Math.pow(10, Math.floor(Math.log(num) / Math.LN10));
      }
      function getNestedProperty(path, parent) {
        const pathElements = path.split('.');
        while (pathElements.length && defined(parent)) {
          const pathElement = pathElements.shift();
          if (
            typeof pathElement === 'undefined' ||
            pathElement === '__proto__'
          ) {
            return;
          }
          if (pathElement === 'this') {
            let thisProp;
            if (isObject(parent)) {
              thisProp = parent['@this'];
            }
            return thisProp ?? parent;
          }
          const child = parent[pathElement.replace(/[\\'"]/g, '')];
          if (
            !defined(child) ||
            typeof child === 'function' ||
            typeof child.nodeType === 'number' ||
            child === win
          ) {
            return;
          }
          parent = child;
        }
        return parent;
      }
      function getStyle(el, prop, toInt) {
        let style;
        if (prop === 'width') {
          let offsetWidth = Math.min(el.offsetWidth, el.scrollWidth);
          // because scrollWidth doesn't support subpixel precision (#6427) ...
          const boundingClientRectWidth = el.getBoundingClientRect?.().width;
          if (
            boundingClientRectWidth < offsetWidth &&
            boundingClientRectWidth >= offsetWidth - 1
          ) {
            offsetWidth = Math.floor(boundingClientRectWidth);
          }
          return Math.max(
            0,
            offsetWidth -
              (getStyle(el, 'padding-left', true) || 0) -
              (getStyle(el, 'padding-right', true) || 0),
          );
        }
        if (prop === 'height') {
          return Math.max(
            0,
            Math.min(el.offsetHeight, el.scrollHeight) -
              (getStyle(el, 'padding-top', true) || 0) -
              (getStyle(el, 'padding-bottom', true) || 0),
          );
        }
        const css = win.getComputedStyle(el, void 0); // eslint-disable-line no-undefined
        if (css) {
          style = css.getPropertyValue(prop);
          if (pick(toInt, prop !== 'opacity')) {
            style = pInt(style);
          }
        }
        return style;
      }
      const find = Array.prototype.find
        ? function (arr, callback) {
            return arr.find(callback);
          }
        :
          function (arr, callback) {
            let i;
            const length = arr.length;
            for (i = 0; i < length; i++) {
              if (callback(arr[i], i)) {
                // eslint-disable-line node/callback-return
                return arr[i];
              }
            }
          };
      function internalClearTimeout(id) {
        if (defined(id)) {
          clearTimeout(id);
        }
      }
      function isDOMElement(obj) {
        return isObject(obj) && typeof obj.nodeType === 'number';
      }
      function isClass(obj) {
        const c = obj?.constructor;
        return !!(
          isObject(obj, true) &&
          !isDOMElement(obj) &&
          c?.name &&
          c.name !== 'Object'
        );
      }
      function isNumber(n) {
        return (
          typeof n === 'number' && !isNaN(n) && n < Infinity && n > -Infinity
        );
      }
      function isString(s) {
        return typeof s === 'string';
      }
      function isArray(obj) {
        const str = Object.prototype.toString.call(obj);
        return str === '[object Array]' || str === '[object Array Iterator]';
      }
      function isFunction(obj) {
        return typeof obj === 'function';
      }
      function isObject(obj, strict) {
        return !!obj && typeof obj === 'object' && (!strict || !isArray(obj)); // eslint-disable-line @typescript-eslint/no-explicit-any
      }
      function merge(extendOrSource, ...sources) {
        let i,
          args = [extendOrSource, ...sources],
          ret = {};
        const doCopy = function (copy, original) {
          if (typeof copy !== 'object') {
            copy = {};
          }
          objectEach(original, function (value, key) {
            if (key === '__proto__' || key === 'constructor') {
              return;
            }
            if (
              isObject(value, true) &&
              !isClass(value) &&
              !isDOMElement(value)
            ) {
              copy[key] = doCopy(copy[key] || {}, value);
            } else {
              copy[key] = original[key];
            }
          });
          return copy;
        };
        if (extendOrSource === true) {
          ret = args[1];
          args = Array.prototype.slice.call(args, 2);
        }
        const len = args.length;
        for (i = 0; i < len; i++) {
          ret = doCopy(ret, args[i]);
        }
        return ret;
      }
      function normalizeTickInterval(
        interval,
        multiples,
        magnitude,
        allowDecimals,
        hasTickAmount,
      ) {
        let i,
          retInterval = interval;
        magnitude = pick(magnitude, getMagnitude(interval));
        const normalized = interval / magnitude;
        if (!multiples) {
          multiples = hasTickAmount
            ?
              [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            :
              [1, 2, 2.5, 5, 10];
          if (allowDecimals === false) {
            if (magnitude === 1) {
              multiples = multiples.filter(function (num) {
                return num % 1 === 0;
              });
            } else if (magnitude <= 0.1) {
              multiples = [1 / magnitude];
            }
          }
        }
        for (i = 0; i < multiples.length; i++) {
          retInterval = multiples[i];
          if (
            (hasTickAmount && retInterval * magnitude >= interval) ||
            (!hasTickAmount &&
              normalized <=
                (multiples[i] + (multiples[i + 1] || multiples[i])) / 2)
          ) {
            break;
          }
        }
        retInterval = correctFloat(
          retInterval * magnitude,
          -Math.round(Math.log(0.001) / Math.LN10),
        );
        return retInterval;
      }
      function objectEach(obj, fn, ctx) {
        for (const key in obj) {
          if (Object.hasOwnProperty.call(obj, key)) {
            fn.call(ctx || obj[key], obj[key], key, obj);
          }
        }
      }
      function offset(el) {
        const docElem = doc.documentElement,
          box =
            el.parentElement || el.parentNode
              ? el.getBoundingClientRect()
              : { top: 0, left: 0, width: 0, height: 0 };
        return {
          top:
            box.top +
            (win.pageYOffset || docElem.scrollTop) -
            (docElem.clientTop || 0),
          left:
            box.left +
            (win.pageXOffset || docElem.scrollLeft) -
            (docElem.clientLeft || 0),
          width: box.width,
          height: box.height,
        };
      }
      function pad(number, length, padder) {
        return (
          new Array(
            (length || 2) + 1 - String(number).replace('-', '').length,
          ).join(padder || '0') + number
        );
      }
      /* eslint-disable jsdoc/check-param-names */
      function pick() {
        const args = arguments;
        const length = args.length;
        for (let i = 0; i < length; i++) {
          const arg = args[i];
          if (typeof arg !== 'undefined' && arg !== null) {
            return arg;
          }
        }
      }
      /* eslint-enable jsdoc/check-param-names */
      /**
       * Shortcut for parseInt
       *
       * @internal
       * @function Highcharts.pInt
       *
       * @param {*} s
       *        any
       *
       * @param {number} [mag]
       *        Magnitude
       *
       * @return {number}
       *         number
       */
      function pInt(s, mag) {
        return parseInt(s, mag || 10);
      }
      function pushUnique(array, item) {
        return array.indexOf(item) < 0 && !!array.push(item);
      }
      function relativeLength(value, base, offset) {
        return /%$/.test(value)
          ? (base * parseFloat(value)) / 100 + (offset || 0)
          : parseFloat(value);
      }
      function replaceNested(text, ...replacements) {
        let previous, replacement;
        do {
          previous = text;
          for (replacement of replacements) {
            text = text.replace(replacement[0], replacement[1]);
          }
        } while (text !== previous);
        return text;
      }
      function removeEvent(el, type, fn) {
        /** @internal */
        function removeOneEvent(type, fn) {
          const removeEventListener = el.removeEventListener;
          if (removeEventListener) {
            removeEventListener.call(el, type, fn, false);
          }
        }
        /** @internal */
        function removeAllEvents(eventCollection) {
          let types, len;
          if (!el.nodeName) {
            return;
          }
          if (type) {
            types = {};
            types[type] = true;
          } else {
            types = eventCollection;
          }
          objectEach(types, function (_val, n) {
            if (eventCollection[n]) {
              len = eventCollection[n].length;
              while (len--) {
                removeOneEvent(n, eventCollection[n][len].fn);
              }
            }
          });
        }
        const owner = (typeof el === 'function' && el.prototype) || el;
        if (Object.hasOwnProperty.call(owner, 'hcEvents')) {
          const events = owner.hcEvents;
          if (type) {
            const typeEvents = events[type] || [];
            if (fn) {
              events[type] = typeEvents.filter(function (obj) {
                return fn !== obj.fn;
              });
              removeOneEvent(type, fn);
            } else {
              removeAllEvents(events);
              events[type] = [];
            }
          } else {
            removeAllEvents(events);
            delete owner.hcEvents;
          }
        }
      }
      function splat(obj) {
        return isArray(obj) ? obj : [obj];
      }
      function stableSort(arr, sortFunction) {
        const length = arr.length;
        let sortValue, i;
        for (i = 0; i < length; i++) {
          arr[i].safeI = i;
        }
        arr.sort(function (a, b) {
          sortValue = sortFunction(a, b);
          return sortValue === 0 ? a.safeI - b.safeI : sortValue;
        });
        for (i = 0; i < length; i++) {
          delete arr[i].safeI;
        }
      }
      function syncTimeout(fn, delay, context) {
        if (delay > 0) {
          return setTimeout(fn, delay, context);
        }
        fn.call(0, context);
        return -1;
      }
      /**
       * @internal
       */
      function ucfirst(s) {
        return isString(s)
          ? s.substring(0, 1).toUpperCase() + s.substring(1)
          : String(s);
      }
      function wrap(obj, method, func) {
        const proceed = obj[method];
        obj[method] = function () {
          const outerArgs = arguments,
            scope = this;
          return func.apply(
            this,
            [
              function () {
                return proceed.apply(
                  scope,
                  arguments.length ? arguments : outerArgs,
                );
              },
            ].concat([].slice.call(arguments)),
          );
        };
      }


      const { isTouchDevice } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      const composedMembers = [];
      let NavigatorConstructor;
      function compose(ChartClass, NavigatorClass) {
        if (pushUnique(composedMembers, ChartClass)) {
          const chartProto = ChartClass.prototype;
          NavigatorConstructor = NavigatorClass;
          chartProto.callbacks.push(onChartCallback);
          addEvent(ChartClass, 'afterAddSeries', onChartAfterAddSeries);
          addEvent(ChartClass, 'afterSetChartSize', onChartAfterSetChartSize);
          addEvent(ChartClass, 'afterUpdate', onChartAfterUpdate);
          addEvent(ChartClass, 'beforeRender', onChartBeforeRender);
          addEvent(
            ChartClass,
            'beforeShowResetZoom',
            onChartBeforeShowResetZoom,
          );
          addEvent(ChartClass, 'update', onChartUpdate);
        }
      }
      function onChartAfterAddSeries() {
        if (this.navigator) {
          this.navigator.setBaseSeries(null, false);
        }
      }
      function onChartAfterSetChartSize() {
        const legend = this.legend,
          navigator = this.navigator;
        let legendOptions, xAxis, yAxis;
        if (navigator) {
          legendOptions = legend && legend.options;
          xAxis = navigator.xAxis;
          yAxis = navigator.yAxis;
          const { scrollbarHeight, scrollButtonSize } = navigator;
          if (this.inverted) {
            navigator.left = navigator.opposite
              ? this.chartWidth - scrollbarHeight - navigator.height
              : this.spacing[3] + scrollbarHeight;
            navigator.top = this.plotTop + scrollButtonSize;
          } else {
            navigator.left = pick(xAxis.left, this.plotLeft + scrollButtonSize);
            navigator.top =
              navigator.navigatorOptions.top ||
              this.chartHeight -
                navigator.height -
                scrollbarHeight -
                (this.scrollbar?.options.margin || 0) -
                this.spacing[2] -
                (this.rangeSelector && this.extraBottomMargin
                  ? this.rangeSelector.getHeight()
                  : 0) -
                (legendOptions &&
                legendOptions.verticalAlign === 'bottom' &&
                legendOptions.layout !== 'proximate' &&
                legendOptions.enabled &&
                !legendOptions.floating
                  ? legend.legendHeight + pick(legendOptions.margin, 10)
                  : 0) -
                (this.titleOffset ? this.titleOffset[2] : 0);
          }
          if (xAxis && yAxis) {
            if (this.inverted) {
              xAxis.options.left = yAxis.options.left = navigator.left;
            } else {
              xAxis.options.top = yAxis.options.top = navigator.top;
            }
            xAxis.setAxisSize();
            yAxis.setAxisSize();
          }
        }
      }
      function onChartAfterUpdate(event) {
        if (
          !this.navigator &&
          !this.scroller &&
          (this.options.navigator.enabled || this.options.scrollbar.enabled)
        ) {
          this.scroller = this.navigator = new NavigatorConstructor(this);
          if (pick(event.redraw, true)) {
            this.redraw(event.animation);
          }
        }
      }
      function onChartBeforeRender() {
        const options = this.options;
        if (options.navigator.enabled || options.scrollbar.enabled) {
          this.scroller = this.navigator = new NavigatorConstructor(this);
        }
      }
      /**
       * For Stock charts. For x only zooming, do not to create the zoom button
       * because X axis zooming is already allowed by the Navigator and Range
       * selector. (#9285)
       * @private
       */
      function onChartBeforeShowResetZoom() {
        const chartOptions = this.options,
          navigator = chartOptions.navigator,
          rangeSelector = chartOptions.rangeSelector;
        if (
          ((navigator && navigator.enabled) ||
            (rangeSelector && rangeSelector.enabled)) &&
          ((!isTouchDevice && this.zooming.type === 'x') ||
            (isTouchDevice && this.zooming.pinchType === 'x'))
        ) {
          return false;
        }
      }
      function onChartCallback(chart) {
        const navigator = chart.navigator;
        if (navigator && chart.xAxis[0]) {
          const extremes = chart.xAxis[0].getExtremes();
          navigator.render(extremes.min, extremes.max);
        }
      }
      function onChartUpdate(e) {
        const navigatorOptions = e.options.navigator || {},
          scrollbarOptions = e.options.scrollbar || {};
        if (
          !this.navigator &&
          !this.scroller &&
          (navigatorOptions.enabled || scrollbarOptions.enabled)
        ) {
          merge(true, this.options.navigator, navigatorOptions);
          merge(true, this.options.scrollbar, scrollbarOptions);
          delete e.options.navigator;
          delete e.options.scrollbar;
        }
      }
      const ChartNavigatorComposition = {
        compose,
      };
       const Navigator_ChartNavigatorComposition =
        ChartNavigatorComposition;


      const { isTouchDevice: NavigatorAxisComposition_isTouchDevice } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      /** @internal */
      function onAxisInit() {
        const axis = this;
        if (!axis.navigatorAxis) {
          axis.navigatorAxis = new NavigatorAxisAdditions(axis);
        }
      }
      /**
       * For Stock charts, override selection zooming with some special features
       * because X axis zooming is already allowed by the Navigator and Range
       * selector.
       * @internal
       */
      function onAxisSetExtremes(e) {
        const axis = this,
          chart = axis.chart,
          chartOptions = chart.options,
          navigator = chartOptions.navigator,
          navigatorAxis = axis.navigatorAxis,
          pinchType = chart.zooming.pinchType,
          rangeSelector = chartOptions.rangeSelector,
          zoomType = chart.zooming.type;
        let zoomed;
        if (axis.isXAxis && (navigator?.enabled || rangeSelector?.enabled)) {
          if (zoomType === 'y' && e.trigger === 'zoom') {
            zoomed = false;
            // otherwise zoom all the way out.
          } else if (
            ((e.trigger === 'zoom' && zoomType === 'xy') ||
              (NavigatorAxisComposition_isTouchDevice && pinchType === 'xy')) &&
            axis.options.range
          ) {
            const previousZoom = navigatorAxis.previousZoom;
            if (defined(e.min)) {
              navigatorAxis.previousZoom = [axis.min, axis.max];
            } else if (previousZoom) {
              e.min = previousZoom[0];
              e.max = previousZoom[1];
              navigatorAxis.previousZoom = void 0;
            }
          }
        }
        if (typeof zoomed !== 'undefined') {
          e.preventDefault();
        }
      }
      /** @internal */
      class NavigatorAxisAdditions {
        static compose(AxisClass) {
          if (!AxisClass.keepProps.includes('navigatorAxis')) {
            AxisClass.keepProps.push('navigatorAxis');
            addEvent(AxisClass, 'init', onAxisInit);
            addEvent(AxisClass, 'setExtremes', onAxisSetExtremes);
          }
        }
        constructor(axis) {
          this.axis = axis;
        }
        destroy() {
          this.axis = void 0;
        }
        /**
         * Add logic to normalize the zoomed range in order to preserve the pressed
         * state of range selector buttons
         *
         * @internal
         * @function Highcharts.Axis#toFixedRange
         */
        toFixedRange(pxMin, pxMax, fixedMin, fixedMax) {
          const axis = this.axis,
            halfPointRange = (axis.pointRange || 0) / 2;
          let newMin = pick(fixedMin, axis.translate(pxMin, true, !axis.horiz)),
            newMax = pick(fixedMax, axis.translate(pxMax, true, !axis.horiz));
          if (!defined(fixedMin)) {
            newMin = correctFloat(newMin + halfPointRange);
          }
          if (!defined(fixedMax)) {
            newMax = correctFloat(newMax - halfPointRange);
          }
          if (!isNumber(newMin) || !isNumber(newMax)) {
            newMin = newMax = void 0;
          }
          return {
            min: newMin,
            max: newMax,
          };
        }
      }
      /** @internal */
       const NavigatorAxisComposition =
        NavigatorAxisAdditions;

      var highcharts_Color_commonjs_highcharts_Color_commonjs2_highcharts_Color_root_Highcharts_Color_ =
        __webpack_require__(620);
      var highcharts_Color_commonjs_highcharts_Color_commonjs2_highcharts_Color_root_Highcharts_Color_default =
         __webpack_require__.n(
          highcharts_Color_commonjs_highcharts_Color_commonjs2_highcharts_Color_root_Highcharts_Color_,
        );
      var highcharts_SeriesRegistry_commonjs_highcharts_SeriesRegistry_commonjs2_highcharts_SeriesRegistry_root_Highcharts_SeriesRegistry_ =
        __webpack_require__(512);
      var highcharts_SeriesRegistry_commonjs_highcharts_SeriesRegistry_commonjs2_highcharts_SeriesRegistry_root_Highcharts_SeriesRegistry_default =
         __webpack_require__.n(
          highcharts_SeriesRegistry_commonjs_highcharts_SeriesRegistry_commonjs2_highcharts_SeriesRegistry_root_Highcharts_SeriesRegistry_,
        );

      const { parse: color } =
        highcharts_Color_commonjs_highcharts_Color_commonjs2_highcharts_Color_root_Highcharts_Color_default();

      const { seriesTypes } =
        highcharts_SeriesRegistry_commonjs_highcharts_SeriesRegistry_commonjs2_highcharts_SeriesRegistry_root_Highcharts_SeriesRegistry_default();
      const NavigatorDefaults = {
        height: 40,
        margin: 22,
        maskInside: true,
        handles: {
          width: 7,
          borderRadius: 0,
          height: 15,
          symbols: ['navigator-handle', 'navigator-handle'],
          enabled: true,
          lineWidth: 1,
          backgroundColor: '#f2f2f2' ,
          borderColor: '#999999' ,
        },
        maskFill: color('#667aff' )
          .setOpacity(0.3)
          .get(),
        outlineColor: '#999999' ,
        outlineWidth: 1,
        series: {
          type:
            typeof seriesTypes.areaspline === 'undefined'
              ? 'line'
              : 'areaspline',
          fillOpacity: 0.05,
          lineWidth: 1,
          compare: null,
          sonification: {
            enabled: false,
          },
          dataGrouping: {
            approximation: 'average',
            enabled: true,
            groupPixelWidth: 2,
            firstAnchor: 'firstPoint',
            anchor: 'middle',
            lastAnchor: 'lastPoint',
            units: [
              ['millisecond', [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]],
              ['second', [1, 2, 5, 10, 15, 30]],
              ['minute', [1, 2, 5, 10, 15, 30]],
              ['hour', [1, 2, 3, 4, 6, 8, 12]],
              ['day', [1, 2, 3, 4]],
              ['week', [1, 2, 3]],
              ['month', [1, 3, 6]],
              ['year', null],
            ],
          },
          dataLabels: {
            enabled: false,
            zIndex: 2,
          },
          id: 'highcharts-navigator-series',
          className: 'highcharts-navigator-series',
          lineColor: null,
          marker: {
            enabled: false,
          },
          threshold: null,
        },
        xAxis: {
          className: 'highcharts-navigator-xaxis',
          tickLength: 0,
          lineWidth: 0,
          gridLineColor: '#e6e6e6' ,
          id: 'navigator-x-axis',
          gridLineWidth: 1,
          tickPixelInterval: 200,
          labels: {
            align: 'left',
            style: {
              color: '#000000' ,
              fontSize: '0.7em',
              opacity: 0.6,
              textOutline: '2px contrast',
            },
            x: 3,
            y: -4,
          },
          crosshair: false,
        },
        yAxis: {
          className: 'highcharts-navigator-yaxis',
          gridLineWidth: 0,
          startOnTick: false,
          endOnTick: false,
          minPadding: 0.1,
          id: 'navigator-y-axis',
          maxPadding: 0.1,
          labels: {
            enabled: false,
          },
          crosshair: false,
          title: {
            text: void 0,
          },
          tickLength: 0,
          tickWidth: 0,
        },
      };
       const Navigator_NavigatorDefaults =
        NavigatorDefaults;
      ('');


      /* eslint-disable require-jsdoc, valid-jsdoc */
      function arc(cx, cy, w, h, options) {
        const arc = [];
        if (options) {
          let start = options.start || 0,
            end = options.end || 0;
          const rx = pick(options.r, w),
            ry = pick(options.r, h || w),
            proximity = 0.0001,
            fullCircle = Math.abs(end - start - 2 * Math.PI) < proximity;
          if (fullCircle) {
            start = Math.PI / 2;
            end = Math.PI * 2.5 - proximity;
          }
          const innerRadius = options.innerR,
            open = pick(options.open, fullCircle),
            cosStart = fullCircle ? 0 : Math.cos(start),
            sinStart = fullCircle ? 1 : Math.sin(start),
            cosEnd = fullCircle ? 0 : Math.cos(end),
            sinEnd = fullCircle ? 1 : Math.sin(end),
            longArc = pick(
              options.longArc,
              end - start - Math.PI < proximity ? 0 : 1,
            );
          let arcSegment = [
            'A',
            rx,
            ry,
            0,
            longArc,
            pick(options.clockwise, 1),
            cx + (fullCircle ? 0.001 : rx * cosEnd),
            cy + ry * sinEnd,
          ];
          arcSegment.params = { start, end, cx, cy };
          arc.push(['M', cx + rx * cosStart, cy + ry * sinStart], arcSegment);
          if (defined(innerRadius)) {
            arcSegment = [
              'A',
              innerRadius,
              innerRadius,
              0,
              longArc,
              defined(options.clockwise) ? 1 - options.clockwise : 0,
              cx + (fullCircle ? -0.001 : innerRadius * cosStart),
              cy + innerRadius * sinStart,
            ];
            arcSegment.params = {
              start: end,
              end: start,
              cx,
              cy,
            };
            arc.push(
              open
                ? ['M', cx + innerRadius * cosEnd, cy + innerRadius * sinEnd]
                : ['L', cx + innerRadius * cosEnd, cy + innerRadius * sinEnd],
              arcSegment,
            );
          }
          if (!open) {
            arc.push(['Z']);
          }
        }
        return arc;
      }
      function callout(x, y, w, h, options) {
        const arrowLength = 6,
          halfDistance = 6,
          r = Math.min(options?.r || 0, w, h),
          safeDistance = r + halfDistance,
          anchorX = options?.anchorX,
          anchorY = options?.anchorY || 0;
        const path = roundedRect(x, y, w, h, { r });
        if (!isNumber(anchorX)) {
          return path;
        }
        if (anchorX < w && anchorX > 0 && anchorY < h && anchorY > 0) {
          return path;
        }
        if (x + anchorX > w - safeDistance) {
          if (anchorY > y + safeDistance && anchorY < y + h - safeDistance) {
            path.splice(
              3,
              1,
              ['L', x + w, anchorY - halfDistance],
              ['L', x + w + arrowLength, anchorY],
              ['L', x + w, anchorY + halfDistance],
              ['L', x + w, y + h - r],
            );
          } else {
            if (anchorX < w) {
              const isTopCorner = anchorY < y + safeDistance,
                cornerY = isTopCorner ? y : y + h,
                sliceStart = isTopCorner ? 2 : 5;
              path.splice(
                sliceStart,
                0,
                ['L', anchorX, anchorY],
                ['L', x + w - r, cornerY],
              );
            } else {
              path.splice(
                3,
                1,
                ['L', x + w, h / 2],
                ['L', anchorX, anchorY],
                ['L', x + w, h / 2],
                ['L', x + w, y + h - r],
              );
            }
          }
        } else if (x + anchorX < safeDistance) {
          if (anchorY > y + safeDistance && anchorY < y + h - safeDistance) {
            path.splice(
              7,
              1,
              ['L', x, anchorY + halfDistance],
              ['L', x - arrowLength, anchorY],
              ['L', x, anchorY - halfDistance],
              ['L', x, y + r],
            );
          } else {
            if (anchorX > 0) {
              const isTopCorner = anchorY < y + safeDistance,
                cornerY = isTopCorner ? y : y + h,
                sliceStart = isTopCorner ? 1 : 6;
              path.splice(
                sliceStart,
                0,
                ['L', anchorX, anchorY],
                ['L', x + r, cornerY],
              );
            } else {
              path.splice(
                7,
                1,
                ['L', x, h / 2],
                ['L', anchorX, anchorY],
                ['L', x, h / 2],
                ['L', x, y + r],
              );
            }
          }
        } else if (
          anchorY > h &&
          anchorX < w - safeDistance
        ) {
          path.splice(
            5,
            1,
            ['L', anchorX + halfDistance, y + h],
            ['L', anchorX, y + h + arrowLength],
            ['L', anchorX - halfDistance, y + h],
            ['L', x + r, y + h],
          );
        } else if (
          anchorY < 0 &&
          anchorX > safeDistance
        ) {
          path.splice(
            1,
            1,
            ['L', anchorX - halfDistance, y],
            ['L', anchorX, y - arrowLength],
            ['L', anchorX + halfDistance, y],
            ['L', w - r, y],
          );
        }
        return path;
      }
      function circle(x, y, w, h) {
        return arc(x + w / 2, y + h / 2, w / 2, h / 2, {
          start: Math.PI * 0.5,
          end: Math.PI * 2.5,
          open: false,
        });
      }
      function diamond(x, y, w, h) {
        return [
          ['M', x + w / 2, y],
          ['L', x + w, y + h / 2],
          ['L', x + w / 2, y + h],
          ['L', x, y + h / 2],
          ['Z'],
        ];
      }
      function rect(x, y, w, h, options) {
        if (options?.r) {
          return roundedRect(x, y, w, h, options);
        }
        return [
          ['M', x, y],
          ['L', x + w, y],
          ['L', x + w, y + h],
          ['L', x, y + h],
          ['Z'],
        ];
      }
      function roundedRect(x, y, w, h, options) {
        const r = options?.r || 0;
        return [
          ['M', x + r, y],
          ['L', x + w - r, y],
          ['A', r, r, 0, 0, 1, x + w, y + r],
          ['L', x + w, y + h - r],
          ['A', r, r, 0, 0, 1, x + w - r, y + h],
          ['L', x + r, y + h],
          ['A', r, r, 0, 0, 1, x, y + h - r],
          ['L', x, y + r],
          ['A', r, r, 0, 0, 1, x + r, y],
          ['Z'],
        ];
      }
      function triangle(x, y, w, h) {
        return [
          ['M', x + w / 2, y],
          ['L', x + w, y + h],
          ['L', x, y + h],
          ['Z'],
        ];
      }
      function triangleDown(x, y, w, h) {
        return [['M', x, y], ['L', x + w, y], ['L', x + w / 2, y + h], ['Z']];
      }
      const Symbols = {
        arc,
        callout,
        circle,
        diamond,
        rect,
        roundedRect,
        square: rect,
        triangle,
        'triangle-down': triangleDown,
      };
       const SVG_Symbols = Symbols;
      ('');


      function navigatorHandle(_x, _y, width, height, options = {}) {
        const halfWidth = options.width ? options.width / 2 : width,
          markerPosition = 1.5,
          r = relativeLength(
            options.borderRadius || 0,
            Math.min(halfWidth * 2, height),
          );
        height = options.height || height;
        return [
          ['M', -markerPosition, height / 2 - 3.5],
          ['L', -markerPosition, height / 2 + 4.5],
          ['M', markerPosition - 1, height / 2 - 3.5],
          ['L', markerPosition - 1, height / 2 + 4.5],
          ...SVG_Symbols.rect(-halfWidth - 1, 0.5, halfWidth * 2 + 1, height, {
            r,
          }),
        ];
      }
      const NavigatorSymbols = {
        'navigator-handle': navigatorHandle,
      };
       const Navigator_NavigatorSymbols =
        NavigatorSymbols;

      var highcharts_RendererRegistry_commonjs_highcharts_RendererRegistry_commonjs2_highcharts_RendererRegistry_root_Highcharts_RendererRegistry_ =
        __webpack_require__(608);
      var highcharts_RendererRegistry_commonjs_highcharts_RendererRegistry_commonjs2_highcharts_RendererRegistry_root_Highcharts_RendererRegistry_default =
         __webpack_require__.n(
          highcharts_RendererRegistry_commonjs_highcharts_RendererRegistry_commonjs2_highcharts_RendererRegistry_root_Highcharts_RendererRegistry_,
        );

      function setFixedRange(range) {
        const xAxis = this.xAxis[0];
        if (defined(xAxis.dataMax) && defined(xAxis.dataMin) && range) {
          this.fixedRange = Math.min(range, xAxis.dataMax - xAxis.dataMin);
        } else {
          this.fixedRange = range;
        }
      }
      const StockUtilities = {
        setFixedRange,
      };
       const Utilities_StockUtilities =
        StockUtilities;


      const { defaultOptions } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      // v11 兼容性：如果 Highcharts.composed 不存在，使用独立的本地数组
      let composed =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
          .composed;
      if (!Array.isArray(composed)) {
        composed = [];
      }

      const { getRendererType } =
        highcharts_RendererRegistry_commonjs_highcharts_RendererRegistry_commonjs2_highcharts_RendererRegistry_root_Highcharts_RendererRegistry_default();

      const { setFixedRange: NavigatorComposition_setFixedRange } =
        Utilities_StockUtilities;

      function NavigatorComposition_compose(
        ChartClass,
        AxisClass,
        SeriesClass,
      ) {
        NavigatorAxisComposition.compose(AxisClass);
        if (pushUnique(composed, 'Navigator')) {
          ChartClass.prototype.setFixedRange =
            NavigatorComposition_setFixedRange;
          extend(
            getRendererType().prototype.symbols,
            Navigator_NavigatorSymbols,
          );
          extend(defaultOptions, { navigator: Navigator_NavigatorDefaults });
          addEvent(SeriesClass, 'afterUpdate', onSeriesAfterUpdate);
        }
      }
      function onSeriesAfterUpdate() {
        if (this.chart.navigator && !this.options.isInternal) {
          this.chart.navigator.setBaseSeries(null, false);
        }
      }
      const NavigatorComposition = {
        compose: NavigatorComposition_compose,
      };
       const Navigator_NavigatorComposition =
        NavigatorComposition;


      const { composed: ScrollbarAxis_composed } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      /** @internal */
      var ScrollbarAxis;
      (function (ScrollbarAxis) {
        let Scrollbar;
        function compose(AxisClass, ScrollbarClass) {
          if (pushUnique(ScrollbarAxis_composed, 'Axis.Scrollbar')) {
            Scrollbar = ScrollbarClass;
            addEvent(AxisClass, 'afterGetOffset', onAxisAfterGetOffset);
            addEvent(AxisClass, 'afterInit', onAxisAfterInit);
            addEvent(AxisClass, 'afterRender', onAxisAfterRender);
          }
        }
        ScrollbarAxis.compose = compose;
        /** @internal */
        function getExtremes(axis) {
          const axisMin = pick(axis.options?.min, axis.min);
          const axisMax = pick(axis.options?.max, axis.max);
          return {
            axisMin,
            axisMax,
            scrollMin: defined(axis.dataMin)
              ? Math.min(
                  axisMin,
                  axis.min ?? Infinity,
                  axis.dataMin,
                  axis.threshold ?? Infinity,
                )
              : axisMin,
            scrollMax:
              axis.treeGrid?.adjustedMax ??
              (defined(axis.dataMax)
                ? Math.max(
                    axisMax,
                    axis.max ?? -Infinity,
                    axis.dataMax,
                    axis.threshold ?? -Infinity,
                  )
                : axisMax),
          };
        }
        /**
         * Make space for a scrollbar.
         * @internal
         */
        function onAxisAfterGetOffset() {
          const axis = this,
            scrollbar = axis.scrollbar,
            opposite = scrollbar && !scrollbar.options.opposite,
            index = axis.horiz ? 2 : opposite ? 3 : 1;
          if (scrollbar) {
            axis.chart.scrollbarsOffsets = [0, 0];
            axis.chart.axisOffset[index] +=
              scrollbar.size + (scrollbar.options.margin || 0);
          }
        }
        /**
         * Wrap axis initialization and create scrollbar if enabled.
         * @internal
         */
        function onAxisAfterInit() {
          const axis = this;
          if (axis.options?.scrollbar?.enabled) {
            axis.options.scrollbar.vertical = !axis.horiz;
            axis.options.startOnTick = axis.options.endOnTick = false;
            axis.scrollbar = new Scrollbar(
              axis.chart.renderer,
              axis.options.scrollbar,
              axis.chart,
            );
            addEvent(axis.scrollbar, 'changed', function (e) {
              const {
                  axisMin,
                  axisMax,
                  scrollMin: unitedMin,
                  scrollMax: unitedMax,
                } = getExtremes(axis),
                minPX = axis.toPixels(unitedMin),
                maxPX = axis.toPixels(unitedMax),
                rangePX = maxPX - minPX;
              let to, from;
              if (!defined(axisMin) || !defined(axisMax)) {
                return;
              }
              if (
                (axis.horiz && !axis.reversed) ||
                (!axis.horiz && axis.reversed)
              ) {
                to = Math.min(
                  unitedMax,
                  axis.toValue(minPX + rangePX * this.to),
                );
                from = Math.max(
                  unitedMin,
                  axis.toValue(minPX + rangePX * this.from),
                );
              } else {
                to = Math.min(
                  unitedMax,
                  axis.toValue(minPX + rangePX * (1 - this.from)),
                );
                from = Math.max(
                  unitedMin,
                  axis.toValue(minPX + rangePX * (1 - this.to)),
                );
              }
              if (this.shouldUpdateExtremes(e.DOMType)) {
                // #17977, set animation to undefined instead of true
                const animate =
                  e.DOMType === 'mousemove' || e.DOMType === 'touchmove'
                    ? false
                    : void 0;
                axis.setExtremes(
                  correctFloat(from),
                  correctFloat(to),
                  true,
                  animate,
                  e,
                );
              } else {
                this.setRange(this.from, this.to);
              }
            });
          }
        }
        /**
         * Wrap rendering axis, and update scrollbar if one is created.
         * @internal
         */
        function onAxisAfterRender() {
          const axis = this,
            { scrollMin, scrollMax } = getExtremes(axis),
            scrollbar = axis.scrollbar,
            offset = (axis.axisTitleMargin || 0) + (axis.titleOffset || 0),
            scrollbarsOffsets = axis.chart.scrollbarsOffsets,
            axisMargin = axis.options.margin || 0;
          let offsetsIndex, from, to;
          if (scrollbar && scrollbarsOffsets) {
            if (axis.horiz) {
              if (!axis.opposite) {
                scrollbarsOffsets[1] += offset;
              }
              scrollbar.position(
                axis.left,
                axis.top +
                  axis.height +
                  2 +
                  scrollbarsOffsets[1] -
                  (axis.opposite ? axisMargin : 0),
                axis.width,
                axis.height,
              );
              if (!axis.opposite) {
                scrollbarsOffsets[1] += axisMargin;
              }
              offsetsIndex = 1;
            } else {
              if (axis.opposite) {
                scrollbarsOffsets[0] += offset;
              }
              let xPosition;
              if (!scrollbar.options.opposite) {
                xPosition = axis.opposite ? 0 : axisMargin;
              } else {
                xPosition =
                  axis.left +
                  axis.width +
                  2 +
                  scrollbarsOffsets[0] -
                  (axis.opposite ? 0 : axisMargin);
              }
              scrollbar.position(xPosition, axis.top, axis.width, axis.height);
              if (axis.opposite) {
                scrollbarsOffsets[0] += axisMargin;
              }
              offsetsIndex = 0;
            }
            scrollbarsOffsets[offsetsIndex] +=
              scrollbar.size + (scrollbar.options.margin || 0);
            if (
              isNaN(scrollMin) ||
              isNaN(scrollMax) ||
              !defined(axis.min) ||
              !defined(axis.max) ||
              (defined(axis.dataMin) &&
                axis.dataMin === axis.dataMax)
            ) {
              scrollbar.setRange(0, 1);
            } else if (axis.min === axis.max) {
              const interval = axis.pointRange / (axis.dataMax + 1);
              from = interval * axis.min;
              to = interval * (axis.max + 1);
              scrollbar.setRange(from, to);
            } else {
              from =
                (axis.toPixels(axis.min) - axis.toPixels(scrollMin)) /
                (axis.toPixels(scrollMax) - axis.toPixels(scrollMin));
              to =
                (axis.toPixels(axis.max) - axis.toPixels(scrollMin)) /
                (axis.toPixels(scrollMax) - axis.toPixels(scrollMin));
              if (
                (axis.horiz && !axis.reversed) ||
                (!axis.horiz && axis.reversed)
              ) {
                scrollbar.setRange(from, to);
              } else {
                scrollbar.setRange(1 - to, 1 - from);
              }
            }
          }
        }
      })(ScrollbarAxis || (ScrollbarAxis = {}));
      /** @internal */
       const Axis_ScrollbarAxis = ScrollbarAxis;


      const ScrollbarDefaults = {
        height: 10,
        barBorderRadius: 5,
        buttonBorderRadius: 0,
        buttonsEnabled: false,
        liveRedraw: void 0,
        margin: void 0,
        minWidth: 6,
        opposite: true,
        step: 0.2,
        zIndex: 3,
        barBackgroundColor: '#cccccc' ,
        barBorderWidth: 0,
        barBorderColor: '#cccccc' ,
        buttonArrowColor: '#333333' ,
        buttonBackgroundColor: '#e6e6e6' ,
        buttonBorderColor: '#cccccc' ,
        buttonBorderWidth: 1,
        rifleColor: 'none',
        trackBackgroundColor: 'rgba(255, 255, 255, 0.001)',
        trackBorderColor: '#cccccc' ,
        trackBorderRadius: 5,
        trackBorderWidth: 1,
      };
       const Scrollbar_ScrollbarDefaults =
        ScrollbarDefaults;


      const { defaultOptions: Scrollbar_defaultOptions } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      const { composed: Scrollbar_composed } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      /* eslint-disable no-invalid-this, valid-jsdoc */
      class Scrollbar {
        static compose(AxisClass) {
          Axis_ScrollbarAxis.compose(AxisClass, Scrollbar);
          if (pushUnique(Scrollbar_composed, 'Scrollbar')) {
            extend(Scrollbar_defaultOptions, {
              scrollbar: Scrollbar_ScrollbarDefaults,
            });
          }
        }
        static swapXY(path, vertical) {
          if (vertical) {
            path.forEach((seg) => {
              const len = seg.length;
              let temp;
              for (let i = 0; i < len; i += 2) {
                temp = seg[i + 1];
                if (typeof temp === 'number') {
                  seg[i + 1] = seg[i + 2];
                  seg[i + 2] = temp;
                }
              }
            });
          }
          return path;
        }
        constructor(renderer, options, chart) {
          this._events = [];
          this.chartX = 0;
          this.chartY = 0;
          this.from = 0;
          this.scrollbarButtons = [];
          this.scrollbarLeft = 0;
          this.scrollbarStrokeWidth = 1;
          this.scrollbarTop = 0;
          this.size = 0;
          this.to = 0;
          this.trackBorderWidth = 1;
          this.x = 0;
          this.y = 0;
          this.init(renderer, options, chart);
        }
        addEvents() {
          const buttonsOrder = this.options.inverted ? [1, 0] : [0, 1],
            buttons = this.scrollbarButtons,
            bar = this.scrollbarGroup.element,
            track = this.track.element,
            mouseDownHandler = this.mouseDownHandler.bind(this),
            mouseMoveHandler = this.mouseMoveHandler.bind(this),
            mouseUpHandler = this.mouseUpHandler.bind(this);
          const _events = [
            [
              buttons[buttonsOrder[0]].element,
              'click',
              this.buttonToMinClick.bind(this),
            ],
            [
              buttons[buttonsOrder[1]].element,
              'click',
              this.buttonToMaxClick.bind(this),
            ],
            [track, 'click', this.trackClick.bind(this)],
            [bar, 'mousedown', mouseDownHandler],
            [bar.ownerDocument, 'mousemove', mouseMoveHandler],
            [bar.ownerDocument, 'mouseup', mouseUpHandler],
            [bar, 'touchstart', mouseDownHandler],
            [bar.ownerDocument, 'touchmove', mouseMoveHandler],
            [bar.ownerDocument, 'touchend', mouseUpHandler],
          ];
          _events.forEach(function (args) {
            addEvent.apply(null, args);
          });
          this._events = _events;
        }
        buttonToMaxClick(e) {
          const scroller = this;
          const range =
            (scroller.to - scroller.from) * pick(scroller.options.step, 0.2);
          scroller.updatePosition(scroller.from + range, scroller.to + range);
          fireEvent(scroller, 'changed', {
            from: scroller.from,
            to: scroller.to,
            trigger: 'scrollbar',
            DOMEvent: e,
          });
        }
        buttonToMinClick(e) {
          const scroller = this;
          const range =
            correctFloat(scroller.to - scroller.from) *
            pick(scroller.options.step, 0.2);
          scroller.updatePosition(
            correctFloat(scroller.from - range),
            correctFloat(scroller.to - range),
          );
          fireEvent(scroller, 'changed', {
            from: scroller.from,
            to: scroller.to,
            trigger: 'scrollbar',
            DOMEvent: e,
          });
        }
        cursorToScrollbarPosition(normalizedEvent) {
          const scroller = this,
            options = scroller.options,
            minWidthDifference =
              options.minWidth > scroller.calculatedWidth
                ? options.minWidth
                : 0;
          return {
            chartX:
              (normalizedEvent.chartX - scroller.x - scroller.xOffset) /
              (scroller.barWidth - minWidthDifference),
            chartY:
              (normalizedEvent.chartY - scroller.y - scroller.yOffset) /
              (scroller.barWidth - minWidthDifference),
          };
        }
        destroy() {
          const scroller = this,
            navigator = scroller.chart.scroller;
          scroller.removeEvents();
          [
            'track',
            'scrollbarRifles',
            'scrollbar',
            'scrollbarGroup',
            'group',
          ].forEach(function (prop) {
            if (scroller[prop] && scroller[prop].destroy) {
              scroller[prop] = scroller[prop].destroy();
            }
          });
          if (navigator && scroller === navigator.scrollbar) {
            navigator.scrollbar = null;
            destroyObjectProperties(navigator.scrollbarButtons);
          }
        }
        drawScrollbarButton(index) {
          const scroller = this,
            renderer = scroller.renderer,
            scrollbarButtons = scroller.scrollbarButtons,
            options = scroller.options,
            size = scroller.size,
            group = renderer.g().add(scroller.group);
          scrollbarButtons.push(group);
          if (options.buttonsEnabled) {
            const rect = renderer
              .rect()
              .addClass('highcharts-scrollbar-button')
              .add(group);
            if (!scroller.chart.styledMode) {
              rect.attr({
                stroke: options.buttonBorderColor,
                'stroke-width': options.buttonBorderWidth,
                fill: options.buttonBackgroundColor,
              });
            }
            rect.attr(
              rect.crisp(
                {
                  x: -0.5,
                  y: -0.5,
                  width: size,
                  height: size,
                  r: options.buttonBorderRadius,
                },
                rect.strokeWidth(),
              ),
            );
            const arrow = renderer
              .path(
                Scrollbar.swapXY(
                  [
                    ['M', size / 2 + (index ? -1 : 1), size / 2 - 3],
                    ['L', size / 2 + (index ? -1 : 1), size / 2 + 3],
                    ['L', size / 2 + (index ? 2 : -2), size / 2],
                  ],
                  options.vertical,
                ),
              )
              .addClass('highcharts-scrollbar-arrow')
              .add(scrollbarButtons[index]);
            if (!scroller.chart.styledMode) {
              arrow.attr({
                fill: options.buttonArrowColor,
              });
            }
          }
        }
        init(renderer, options, chart) {
          const scroller = this;
          scroller.scrollbarButtons = [];
          scroller.renderer = renderer;
          scroller.userOptions = options;
          scroller.options = merge(
            Scrollbar_ScrollbarDefaults,
            Scrollbar_defaultOptions.scrollbar,
            options,
          );
          scroller.options.margin = pick(scroller.options.margin, 10);
          scroller.chart = chart;
          scroller.size = pick(scroller.options.size, scroller.options.height);
          if (options.enabled) {
            scroller.render();
            scroller.addEvents();
          }
        }
        mouseDownHandler(e) {
          const scroller = this,
            normalizedEvent = scroller.chart.pointer?.normalize(e) || e,
            mousePosition = scroller.cursorToScrollbarPosition(normalizedEvent);
          scroller.chartX = mousePosition.chartX;
          scroller.chartY = mousePosition.chartY;
          scroller.initPositions = [scroller.from, scroller.to];
          scroller.grabbedCenter = true;
        }
        mouseMoveHandler(e) {
          const scroller = this,
            normalizedEvent = scroller.chart.pointer?.normalize(e) || e,
            options = scroller.options,
            direction = options.vertical ? 'chartY' : 'chartX',
            initPositions = scroller.initPositions || [];
          let scrollPosition, chartPosition, change;
          if (
            scroller.grabbedCenter &&
            (!e.touches || e.touches[0][direction] !== 0)
          ) {
            chartPosition =
              scroller.cursorToScrollbarPosition(normalizedEvent)[direction];
            scrollPosition = scroller[direction];
            change = chartPosition - scrollPosition;
            scroller.hasDragged = true;
            scroller.updatePosition(
              initPositions[0] + change,
              initPositions[1] + change,
            );
            if (scroller.hasDragged) {
              fireEvent(scroller, 'changed', {
                from: scroller.from,
                to: scroller.to,
                trigger: 'scrollbar',
                DOMType: e.type,
                DOMEvent: e,
              });
            }
          }
        }
        mouseUpHandler(e) {
          const scroller = this;
          if (scroller.hasDragged) {
            fireEvent(scroller, 'changed', {
              from: scroller.from,
              to: scroller.to,
              trigger: 'scrollbar',
              DOMType: e.type,
              DOMEvent: e,
            });
          }
          scroller.grabbedCenter =
            scroller.hasDragged =
            scroller.chartX =
            scroller.chartY =
              null;
        }
        position(x, y, width, height) {
          const scroller = this,
            options = scroller.options,
            { buttonsEnabled, margin = 0, vertical } = options,
            method = scroller.rendered ? 'animate' : 'attr';
          let xOffset = height,
            yOffset = 0;
          scroller.group.show();
          scroller.x = x;
          scroller.y = y + this.trackBorderWidth;
          scroller.width = width;
          scroller.height = height;
          scroller.xOffset = xOffset;
          scroller.yOffset = yOffset;
          if (vertical) {
            scroller.width = scroller.yOffset = width = yOffset = scroller.size;
            scroller.xOffset = xOffset = 0;
            scroller.yOffset = yOffset = buttonsEnabled ? scroller.size : 0;
            scroller.barWidth = height - (buttonsEnabled ? width * 2 : 0);
            scroller.x = x = x + margin;
          } else {
            scroller.height = height = scroller.size;
            scroller.xOffset = xOffset = buttonsEnabled ? scroller.size : 0;
            scroller.barWidth = width - (buttonsEnabled ? height * 2 : 0);
            scroller.y = scroller.y + margin;
          }
          scroller.group[method]({
            translateX: x,
            translateY: scroller.y,
          });
          scroller.track[method]({
            width: width,
            height: height,
          });
          scroller.scrollbarButtons[1][method]({
            translateX: vertical ? 0 : width - xOffset,
            translateY: vertical ? height - yOffset : 0,
          });
        }
        removeEvents() {
          this._events.forEach(function (args) {
            removeEvent.apply(null, args);
          });
          this._events.length = 0;
        }
        render() {
          const scroller = this,
            renderer = scroller.renderer,
            options = scroller.options,
            size = scroller.size,
            styledMode = scroller.chart.styledMode,
            group = renderer
              .g('scrollbar')
              .attr({
                zIndex: options.zIndex,
              })
              .hide()
              .add();
          scroller.group = group;
          scroller.track = renderer
            .rect()
            .addClass('highcharts-scrollbar-track')
            .attr({
              r: options.trackBorderRadius || 0,
              height: size,
              width: size,
            })
            .add(group);
          if (!styledMode) {
            scroller.track.attr({
              fill: options.trackBackgroundColor,
              stroke: options.trackBorderColor,
              'stroke-width': options.trackBorderWidth,
            });
          }
          const trackBorderWidth = (scroller.trackBorderWidth =
            scroller.track.strokeWidth());
          scroller.track.attr({
            x: -crisp(0, trackBorderWidth),
            y: -crisp(0, trackBorderWidth),
          });
          scroller.scrollbarGroup = renderer.g().add(group);
          scroller.scrollbar = renderer
            .rect()
            .addClass('highcharts-scrollbar-thumb')
            .attr({
              height: size - trackBorderWidth,
              width: size - trackBorderWidth,
              r: options.barBorderRadius || 0,
            })
            .add(scroller.scrollbarGroup);
          scroller.scrollbarRifles = renderer
            .path(
              Scrollbar.swapXY(
                [
                  ['M', -3, size / 4],
                  ['L', -3, (2 * size) / 3],
                  ['M', 0, size / 4],
                  ['L', 0, (2 * size) / 3],
                  ['M', 3, size / 4],
                  ['L', 3, (2 * size) / 3],
                ],
                options.vertical,
              ),
            )
            .addClass('highcharts-scrollbar-rifles')
            .add(scroller.scrollbarGroup);
          if (!styledMode) {
            scroller.scrollbar.attr({
              fill: options.barBackgroundColor,
              stroke: options.barBorderColor,
              'stroke-width': options.barBorderWidth,
            });
            scroller.scrollbarRifles.attr({
              stroke: options.rifleColor,
              'stroke-width': 1,
            });
          }
          scroller.scrollbarStrokeWidth = scroller.scrollbar.strokeWidth();
          scroller.scrollbarGroup.translate(
            -crisp(0, scroller.scrollbarStrokeWidth),
            -crisp(0, scroller.scrollbarStrokeWidth),
          );
          scroller.drawScrollbarButton(0);
          scroller.drawScrollbarButton(1);
        }
        setRange(from, to) {
          const scroller = this,
            options = scroller.options,
            vertical = options.vertical,
            minWidth = options.minWidth,
            fullWidth = scroller.barWidth,
            method =
              this.rendered &&
              !this.hasDragged &&
              !(this.chart.navigator && this.chart.navigator.hasDragged)
                ? 'animate'
                : 'attr';
          if (!defined(fullWidth)) {
            return;
          }
          const toPX = fullWidth * Math.min(to, 1);
          let fromPX, newSize;
          from = Math.max(from, 0);
          fromPX = Math.ceil(fullWidth * from);
          scroller.calculatedWidth = newSize = correctFloat(toPX - fromPX);
          if (newSize < minWidth) {
            fromPX = (fullWidth - minWidth + newSize) * from;
            newSize = minWidth;
          }
          const newPos = Math.floor(
            fromPX + scroller.xOffset + scroller.yOffset,
          );
          const newRiflesPos = newSize / 2 - 0.5;
          scroller.from = from;
          scroller.to = to;
          if (!vertical) {
            scroller.scrollbarGroup[method]({
              translateX: newPos,
            });
            scroller.scrollbar[method]({
              width: newSize,
            });
            scroller.scrollbarRifles[method]({
              translateX: newRiflesPos,
            });
            scroller.scrollbarLeft = newPos;
            scroller.scrollbarTop = 0;
          } else {
            scroller.scrollbarGroup[method]({
              translateY: newPos,
            });
            scroller.scrollbar[method]({
              height: newSize,
            });
            scroller.scrollbarRifles[method]({
              translateY: newRiflesPos,
            });
            scroller.scrollbarTop = newPos;
            scroller.scrollbarLeft = 0;
          }
          if (newSize <= 12) {
            scroller.scrollbarRifles.hide();
          } else {
            scroller.scrollbarRifles.show();
          }
          if (options.showFull === false) {
            if (from <= 0 && to >= 1) {
              scroller.group.hide();
            } else {
              scroller.group.show();
            }
          }
          scroller.rendered = true;
        }
        shouldUpdateExtremes(eventType) {
          return (
            pick(
              this.options.liveRedraw,
              highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
                .svg &&
                !highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
                  .isTouchDevice &&
                !this.chart.boosted,
            ) ||
            eventType === 'mouseup' ||
            eventType === 'touchend' ||
            !defined(eventType)
          );
        }
        trackClick(e) {
          const scroller = this;
          const normalizedEvent = scroller.chart.pointer?.normalize(e) || e,
            range = scroller.to - scroller.from,
            top = scroller.y + scroller.scrollbarTop,
            left = scroller.x + scroller.scrollbarLeft;
          if (
            (scroller.options.vertical && normalizedEvent.chartY > top) ||
            (!scroller.options.vertical && normalizedEvent.chartX > left)
          ) {
            scroller.updatePosition(scroller.from + range, scroller.to + range);
          } else {
            scroller.updatePosition(scroller.from - range, scroller.to - range);
          }
          fireEvent(scroller, 'changed', {
            from: scroller.from,
            to: scroller.to,
            trigger: 'scrollbar',
            DOMEvent: e,
          });
        }
        update(options) {
          this.destroy();
          this.init(
            this.chart.renderer,
            merge(true, this.options, options),
            this.chart,
          );
        }
        updatePosition(from, to) {
          if (to > 1) {
            from = correctFloat(1 - correctFloat(to - from));
            to = 1;
          }
          if (from < 0) {
            to = correctFloat(to - from);
            from = 0;
          }
          this.from = from;
          this.to = to;
        }
      }
      Scrollbar.defaultOptions = Scrollbar_ScrollbarDefaults;
       const Scrollbar_Scrollbar = Scrollbar;


      const { defaultOptions: Navigator_defaultOptions } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      const { isTouchDevice: Navigator_isTouchDevice } =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      function numExt(extreme, ...args) {
        const numbers = [].filter.call(args, isNumber);
        if (numbers.length) {
          return Math[extreme].apply(0, numbers);
        }
      }
      class Navigator {
        static compose(ChartClass, AxisClass, SeriesClass) {
          Navigator_ChartNavigatorComposition.compose(ChartClass, Navigator);
          Navigator_NavigatorComposition.compose(
            ChartClass,
            AxisClass,
            SeriesClass,
          );
        }
        constructor(chart) {
          this.isDirty = false;
          this.scrollbarHeight = 0;
          this.init(chart);
        }
        drawHandle(x, index, inverted, verb) {
          const navigator = this,
            height = navigator.navigatorOptions.handles.height;
          navigator.handles[index][verb](
            inverted
              ? {
                  translateX: Math.round(navigator.left + navigator.height / 2),
                  translateY: Math.round(
                    navigator.top + parseInt(x, 10) + 0.5 - height,
                  ),
                }
              : {
                  translateX: Math.round(navigator.left + parseInt(x, 10)),
                  translateY: Math.round(
                    navigator.top + navigator.height / 2 - height / 2 - 1,
                  ),
                },
          );
        }
        drawOutline(zoomedMin, zoomedMax, inverted, verb) {
          const navigator = this,
            maskInside = navigator.navigatorOptions.maskInside,
            outlineWidth = navigator.outline.strokeWidth(),
            halfOutline = outlineWidth / 2,
            outlineCorrection = (outlineWidth % 2) / 2,
            scrollButtonSize = navigator.scrollButtonSize,
            navigatorSize = navigator.size,
            navigatorTop = navigator.top,
            height = navigator.height,
            lineTop = navigatorTop - halfOutline,
            lineBtm = navigatorTop + height;
          let left = navigator.left,
            verticalMin,
            path;
          if (inverted) {
            verticalMin = navigatorTop + zoomedMax + outlineCorrection;
            zoomedMax = navigatorTop + zoomedMin + outlineCorrection;
            path = [
              [
                'M',
                left + height,
                navigatorTop - scrollButtonSize - outlineCorrection,
              ],
              ['L', left + height, verticalMin],
              ['L', left, verticalMin],
              ['M', left, zoomedMax],
              ['L', left + height, zoomedMax],
              [
                'L',
                left + height,
                navigatorTop + navigatorSize + scrollButtonSize,
              ],
            ];
            if (maskInside) {
              path.push(
                ['M', left + height, verticalMin - halfOutline],
                ['L', left + height, zoomedMax + halfOutline],
              );
            }
          } else {
            left -= scrollButtonSize;
            zoomedMin += left + scrollButtonSize - outlineCorrection;
            zoomedMax += left + scrollButtonSize - outlineCorrection;
            path = [
              ['M', left, lineTop],
              ['L', zoomedMin, lineTop],
              ['L', zoomedMin, lineBtm],
              ['M', zoomedMax, lineBtm],
              ['L', zoomedMax, lineTop],
              ['L', left + navigatorSize + scrollButtonSize * 2, lineTop],
            ];
            if (maskInside) {
              path.push(
                ['M', zoomedMin - halfOutline, lineTop],
                ['L', zoomedMax + halfOutline, lineTop],
              );
            }
          }
          navigator.outline[verb]({
            d: path,
          });
        }
        drawMasks(zoomedMin, zoomedMax, inverted, verb) {
          const navigator = this,
            left = navigator.left,
            top = navigator.top,
            navigatorHeight = navigator.height;
          let height, width, x, y;
          if (inverted) {
            x = [left, left, left];
            y = [top, top + zoomedMin, top + zoomedMax];
            width = [navigatorHeight, navigatorHeight, navigatorHeight];
            height = [
              zoomedMin,
              zoomedMax - zoomedMin,
              navigator.size - zoomedMax,
            ];
          } else {
            x = [left, left + zoomedMin, left + zoomedMax];
            y = [top, top, top];
            width = [
              zoomedMin,
              zoomedMax - zoomedMin,
              navigator.size - zoomedMax,
            ];
            height = [navigatorHeight, navigatorHeight, navigatorHeight];
          }
          navigator.shades.forEach((shade, i) => {
            shade[verb]({
              x: x[i],
              y: y[i],
              width: width[i],
              height: height[i],
            });
          });
        }
        renderElements() {
          const navigator = this,
            navigatorOptions = navigator.navigatorOptions,
            maskInside = navigatorOptions.maskInside,
            chart = navigator.chart,
            inverted = chart.inverted,
            renderer = chart.renderer,
            mouseCursor = {
              cursor: inverted ? 'ns-resize' : 'ew-resize',
            },
            navigatorGroup =
              navigator.navigatorGroup ??
              (navigator.navigatorGroup = renderer
                .g('navigator')
                .attr({
                  zIndex: 8,
                  visibility: 'hidden',
                })
                .add());
          [!maskInside, maskInside, !maskInside].forEach((hasMask, index) => {
            const shade =
              navigator.shades[index] ??
              (navigator.shades[index] = renderer
                .rect()
                .addClass(
                  'highcharts-navigator-mask' +
                    (index === 1 ? '-inside' : '-outside'),
                )
                .add(navigatorGroup));
            if (!chart.styledMode) {
              shade.attr({
                fill: hasMask ? navigatorOptions.maskFill : 'rgba(0,0,0,0)',
              });
              if (index === 1) {
                shade.css(mouseCursor);
              }
            }
          });
          if (!navigator.outline) {
            navigator.outline = renderer
              .path()
              .addClass('highcharts-navigator-outline')
              .add(navigatorGroup);
          }
          if (!chart.styledMode) {
            navigator.outline.attr({
              'stroke-width': navigatorOptions.outlineWidth,
              stroke: navigatorOptions.outlineColor,
            });
          }
          if (navigatorOptions.handles?.enabled) {
            let redrawHandles = false;
            const handlesOptions = navigatorOptions.handles,
              { height, width } = handlesOptions;
            [0, 1].forEach((index) => {
              const newSymbolName = handlesOptions.symbols[index];
              redrawHandles =
                redrawHandles ||
                navigator.handles[index]?.symbolName !== newSymbolName;
              if (redrawHandles) {
                navigator.handles[index]?.destroy();
                navigator.handles[index] = renderer.symbol(
                  newSymbolName,
                  -width / 2 - 1,
                  0,
                  width,
                  height,
                  handlesOptions,
                );
                // because of the tooltip in inverted chart (#2908).
                navigator.handles[index]
                  .attr({ zIndex: 7 - index })
                  .addClass(
                    'highcharts-navigator-handle ' +
                      'highcharts-navigator-handle-' +
                      ['left', 'right'][index],
                  )
                  .add(navigatorGroup);
              }
              if (chart.inverted) {
                navigator.handles[index].attr({
                  rotation: 90,
                  rotationOriginX: Math.floor(-width / 2),
                  rotationOriginY: (height + width) / 2,
                });
              }
              if (!chart.styledMode) {
                navigator.handles[index]
                  .attr({
                    fill: handlesOptions.backgroundColor,
                    stroke: handlesOptions.borderColor,
                    'stroke-width': handlesOptions.lineWidth,
                    width: handlesOptions.width,
                    height: handlesOptions.height,
                    x: -width / 2 - 1,
                    y: 0,
                  })
                  .css(mouseCursor);
              }
            });
            if (redrawHandles) {
              navigator.partsEventsToUnbind?.forEach((unbind) => {
                unbind();
              });
              navigator.partsEventsToUnbind = [
                ...navigator.getPartsEvents('mousedown'),
                ...navigator.getPartsEvents('touchstart'),
              ];
            }
          }
        }
        update(options, redraw = false) {
          const chart = this.chart,
            invertedUpdate =
              chart.options.chart.inverted !==
              chart.scrollbar?.options.vertical;
          merge(true, chart.options.navigator, options);
          this.navigatorOptions = chart.options.navigator || {};
          this.setOpposite();
          if (defined(options.enabled) || invertedUpdate) {
            this.destroy();
            this.navigatorEnabled = options.enabled || this.navigatorEnabled;
            return this.init(chart);
          }
          if (this.navigatorEnabled) {
            this.isDirty = true;
            if (options.adaptToUpdatedData === false) {
              this.baseSeries.forEach((series) => {
                removeEvent(series, 'updatedData', this.updatedDataHandler);
              }, this);
            }
            if (options.adaptToUpdatedData) {
              this.baseSeries.forEach((series) => {
                series.eventsToUnbind.push(
                  addEvent(series, 'updatedData', this.updatedDataHandler),
                );
              }, this);
            }
            if (options.series || options.baseSeries) {
              this.setBaseSeries(void 0, false);
            }
            if (options.height || options.xAxis || options.yAxis) {
              this.height = options.height ?? this.height;
              const offsets = this.getXAxisOffsets();
              this.xAxis.update(
                {
                  ...options.xAxis,
                  offsets,
                  [chart.inverted ? 'width' : 'height']: this.height,
                  [chart.inverted ? 'height' : 'width']: void 0,
                },
                false,
              );
              this.yAxis.update(
                {
                  ...options.yAxis,
                  [chart.inverted ? 'width' : 'height']: this.height,
                },
                false,
              );
            }
          }
          if (redraw) {
            chart.redraw();
          }
        }
        render(min, max, pxMin, pxMax) {
          const navigator = this,
            chart = navigator.chart,
            xAxis = navigator.xAxis,
            pointRange = xAxis.pointRange || 0,
            scrollbarXAxis = xAxis.navigatorAxis.fake ? chart.xAxis[0] : xAxis,
            navigatorEnabled = navigator.navigatorEnabled,
            rendered = navigator.rendered,
            inverted = chart.inverted,
            minRange = chart.xAxis[0].minRange,
            maxRange = chart.xAxis[0].options.maxRange,
            scrollButtonSize = navigator.scrollButtonSize;
          let navigatorWidth,
            scrollbarLeft,
            scrollbarTop,
            scrollbarHeight = navigator.scrollbarHeight,
            navigatorSize,
            verb;
          if (this.hasDragged && !defined(pxMin)) {
            return;
          }
          if (this.isDirty) {
            this.renderElements();
          }
          min = correctFloat(min - pointRange / 2);
          max = correctFloat(max + pointRange / 2);
          if (!isNumber(min) || !isNumber(max)) {
            if (rendered) {
              pxMin = 0;
              pxMax = pick(xAxis.width, scrollbarXAxis.width);
            } else {
              return;
            }
          }
          navigator.left = pick(
            xAxis.left,
            chart.plotLeft +
              scrollButtonSize +
              (inverted ? chart.plotWidth : 0),
          );
          let zoomedMax =
            (navigator.size =
            navigatorSize =
              pick(
                xAxis.len,
                (inverted ? chart.plotHeight : chart.plotWidth) -
                  2 * scrollButtonSize,
              ));
          if (inverted) {
            navigatorWidth = scrollbarHeight;
          } else {
            navigatorWidth = navigatorSize + 2 * scrollButtonSize;
          }
          pxMin = pick(pxMin, xAxis.toPixels(min, true));
          pxMax = pick(pxMax, xAxis.toPixels(max, true));
          if (!isNumber(pxMin) || Math.abs(pxMin) === Infinity) {
            pxMin = 0;
            pxMax = navigatorWidth;
          }
          const newMin = xAxis.toValue(pxMin, true),
            newMax = xAxis.toValue(pxMax, true),
            currentRange = Math.abs(correctFloat(newMax - newMin));
          if (defined(minRange) && currentRange < minRange) {
            if (this.grabbedLeft) {
              pxMin = xAxis.toPixels(newMax - minRange - pointRange, true);
            } else if (this.grabbedRight) {
              pxMax = xAxis.toPixels(newMin + minRange + pointRange, true);
            }
          } else if (
            defined(maxRange) &&
            correctFloat(currentRange - pointRange) > maxRange
          ) {
            if (this.grabbedLeft) {
              pxMin = xAxis.toPixels(newMax - maxRange - pointRange, true);
            } else if (this.grabbedRight) {
              pxMax = xAxis.toPixels(newMin + maxRange + pointRange, true);
            }
          }
          navigator.zoomedMax = clamp(Math.max(pxMin, pxMax), 0, zoomedMax);
          navigator.zoomedMin = clamp(
            navigator.fixedWidth
              ? navigator.zoomedMax - navigator.fixedWidth
              : Math.min(pxMin, pxMax),
            0,
            zoomedMax,
          );
          navigator.range = navigator.zoomedMax - navigator.zoomedMin;
          zoomedMax = Math.round(navigator.zoomedMax);
          const zoomedMin = Math.round(navigator.zoomedMin);
          if (navigatorEnabled) {
            navigator.navigatorGroup.attr({
              visibility: 'inherit',
            });
            verb = rendered && !navigator.hasDragged ? 'animate' : 'attr';
            navigator.drawMasks(zoomedMin, zoomedMax, inverted, verb);
            navigator.drawOutline(zoomedMin, zoomedMax, inverted, verb);
            if (navigator.navigatorOptions.handles?.enabled) {
              navigator.drawHandle(zoomedMin, 0, inverted, verb);
              navigator.drawHandle(zoomedMax, 1, inverted, verb);
            }
          }
          if (navigator.scrollbar) {
            if (inverted) {
              scrollbarTop = navigator.top - scrollButtonSize;
              scrollbarLeft =
                navigator.left -
                scrollbarHeight +
                (navigatorEnabled || !scrollbarXAxis.opposite
                  ? 0
                  :
                    (scrollbarXAxis.titleOffset || 0) +
                    scrollbarXAxis.axisTitleMargin);
              scrollbarHeight = navigatorSize + 2 * scrollButtonSize;
            } else {
              scrollbarTop =
                navigator.top +
                (navigatorEnabled ? navigator.height : -scrollbarHeight);
              scrollbarLeft = navigator.left - scrollButtonSize;
            }
            navigator.scrollbar.position(
              scrollbarLeft,
              scrollbarTop,
              navigatorWidth,
              scrollbarHeight,
            );
            navigator.scrollbar.setRange(
              // Use real value, not rounded because range can be very small
              navigator.zoomedMin / (navigatorSize || 1),
              navigator.zoomedMax / (navigatorSize || 1),
            );
          }
          navigator.rendered = true;
          this.isDirty = false;
          fireEvent(this, 'afterRender');
        }
        addMouseEvents() {
          const navigator = this,
            chart = navigator.chart,
            container = chart.container;
          const eventsToUnbind = [];
          let mouseMoveHandler, mouseUpHandler;
          navigator.mouseMoveHandler = mouseMoveHandler = function (e) {
            navigator.onMouseMove(e);
          };
          navigator.mouseUpHandler = mouseUpHandler = function (e) {
            navigator.onMouseUp(e);
          };
          eventsToUnbind.push(
            // because Navigator.grabbedSomething flags are stored in mousedown
            addEvent(chart.renderTo, 'mousemove', mouseMoveHandler),
            addEvent(container.ownerDocument, 'mouseup', mouseUpHandler),
            addEvent(chart.renderTo, 'touchmove', mouseMoveHandler),
            addEvent(container.ownerDocument, 'touchend', mouseUpHandler),
          );
          navigator.eventsToUnbind = eventsToUnbind;
          if (navigator.series && navigator.series[0]) {
            eventsToUnbind.push(
              addEvent(navigator.series[0].xAxis, 'foundExtremes', function () {
                chart.navigator?.modifyNavigatorAxisExtremes();
              }),
            );
          }
        }
        getPartsEvents(eventName) {
          const navigator = this,
            events = [];
          ['shades', 'handles'].forEach((name) => {
            navigator[name].forEach(function (navigatorItem, index) {
              events.push(
                addEvent(navigatorItem.element, eventName, function (e) {
                  navigator[`${name}Mousedown`](e, index);
                }),
              );
            });
          });
          return events;
        }
        shadesMousedown(e, index) {
          e = this.chart.pointer?.normalize(e) || e;
          const navigator = this,
            chart = navigator.chart,
            xAxis = navigator.xAxis,
            zoomedMin = navigator.zoomedMin,
            navigatorSize = navigator.size,
            range = navigator.range;
          let navigatorPosition = navigator.left,
            chartX = e.chartX,
            fixedMax,
            fixedMin,
            ext,
            left;
          if (chart.inverted) {
            chartX = e.chartY;
            navigatorPosition = navigator.top;
          }
          if (index === 1) {
            navigator.grabbedCenter = chartX;
            navigator.fixedWidth = range;
            navigator.dragOffset = chartX - zoomedMin;
          } else {
            left = chartX - navigatorPosition - range / 2;
            if (index === 0) {
              left = Math.max(0, left);
            } else if (index === 2 && left + range >= navigatorSize) {
              left = navigatorSize - range;
              if (navigator.reversedExtremes) {
                left -= range;
                fixedMin = navigator.getUnionExtremes()?.dataMin;
              } else {
                fixedMax = navigator.getUnionExtremes()?.dataMax;
              }
            }
            if (left !== zoomedMin) {
              navigator.fixedWidth = range;
              ext = xAxis.navigatorAxis.toFixedRange(
                left,
                left + range,
                fixedMin,
                fixedMax,
              );
              if (defined(ext.min)) {
                fireEvent(this, 'setRange', {
                  min: Math.min(ext.min, ext.max),
                  max: Math.max(ext.min, ext.max),
                  redraw: true,
                  eventArguments: {
                    trigger: 'navigator',
                  },
                });
              }
            }
          }
        }
        handlesMousedown(e, index) {
          e = this.chart.pointer?.normalize(e) || e;
          const navigator = this,
            chart = navigator.chart,
            baseXAxis = chart.xAxis[0],
            reverse = navigator.reversedExtremes;
          if (index === 0) {
            navigator.grabbedLeft = true;
            navigator.otherHandlePos = navigator.zoomedMax;
            navigator.fixedExtreme = reverse ? baseXAxis.min : baseXAxis.max;
          } else {
            navigator.grabbedRight = true;
            navigator.otherHandlePos = navigator.zoomedMin;
            navigator.fixedExtreme = reverse ? baseXAxis.max : baseXAxis.min;
          }
          chart.setFixedRange(void 0);
        }
        onMouseMove(e) {
          const navigator = this,
            chart = navigator.chart,
            navigatorSize = navigator.navigatorSize,
            range = navigator.range,
            dragOffset = navigator.dragOffset,
            inverted = chart.inverted;
          let left = navigator.left,
            chartX;
          if (!e.touches || e.touches[0].pageX !== 0) {
            e = chart.pointer?.normalize(e) || e;
            chartX = e.chartX;
            if (inverted) {
              left = navigator.top;
              chartX = e.chartY;
            }
            if (navigator.grabbedLeft) {
              navigator.hasDragged = true;
              navigator.render(0, 0, chartX - left, navigator.otherHandlePos);
            } else if (navigator.grabbedRight) {
              navigator.hasDragged = true;
              navigator.render(0, 0, navigator.otherHandlePos, chartX - left);
            } else if (navigator.grabbedCenter && dragOffset) {
              navigator.hasDragged = true;
              if (chartX < dragOffset) {
                chartX = dragOffset;
              } else if (chartX > navigatorSize + dragOffset - range) {
                chartX = navigatorSize + dragOffset - range;
              }
              navigator.render(
                0,
                0,
                chartX - dragOffset,
                chartX - dragOffset + range,
              );
            }
            if (
              navigator.hasDragged &&
              pick(
                navigator.scrollbarOptions?.liveRedraw,
                !Navigator_isTouchDevice && !this.chart.boosted,
              )
            ) {
              e.DOMType = e.type;
              setTimeout(function () {
                navigator.onMouseUp(e);
              }, 0);
            }
          }
        }
        onMouseUp(e) {
          const navigator = this,
            chart = navigator.chart,
            xAxis = navigator.xAxis,
            scrollbar = navigator.scrollbar,
            DOMEvent = e.DOMEvent || e,
            inverted = chart.inverted,
            verb =
              navigator.rendered && !navigator.hasDragged ? 'animate' : 'attr';
          let zoomedMax, zoomedMin, unionExtremes, fixedMin, fixedMax, ext;
          if (
            (navigator.hasDragged && (!scrollbar || !scrollbar.hasDragged)) ||
            e.trigger === 'scrollbar'
          ) {
            unionExtremes = navigator.getUnionExtremes();
            if (navigator.zoomedMin === navigator.otherHandlePos) {
              fixedMin = navigator.fixedExtreme;
            } else if (navigator.zoomedMax === navigator.otherHandlePos) {
              fixedMax = navigator.fixedExtreme;
            }
            if (navigator.zoomedMax === navigator.size) {
              fixedMax = navigator.reversedExtremes
                ? unionExtremes.dataMin
                : unionExtremes.dataMax;
            }
            if (navigator.zoomedMin === 0) {
              fixedMin = navigator.reversedExtremes
                ? unionExtremes.dataMax
                : unionExtremes.dataMin;
            }
            ext = xAxis.navigatorAxis.toFixedRange(
              navigator.zoomedMin,
              navigator.zoomedMax,
              fixedMin,
              fixedMax,
            );
            if (defined(ext.min)) {
              fireEvent(this, 'setRange', {
                min: Math.min(ext.min, ext.max),
                max: Math.max(ext.min, ext.max),
                redraw: true,
                animation: navigator.hasDragged ? false : null,
                eventArguments: {
                  trigger: 'navigator',
                  triggerOp: 'navigator-drag',
                  DOMEvent: DOMEvent,
                },
              });
            }
          }
          if (e.DOMType !== 'mousemove' && e.DOMType !== 'touchmove') {
            navigator.grabbedLeft =
              navigator.grabbedRight =
              navigator.grabbedCenter =
              navigator.fixedWidth =
              navigator.fixedExtreme =
              navigator.otherHandlePos =
              navigator.hasDragged =
              navigator.dragOffset =
                null;
          }
          if (
            navigator.navigatorEnabled &&
            isNumber(navigator.zoomedMin) &&
            isNumber(navigator.zoomedMax)
          ) {
            zoomedMin = Math.round(navigator.zoomedMin);
            zoomedMax = Math.round(navigator.zoomedMax);
            if (navigator.shades) {
              navigator.drawMasks(zoomedMin, zoomedMax, inverted, verb);
            }
            if (navigator.outline) {
              navigator.drawOutline(zoomedMin, zoomedMax, inverted, verb);
            }
            if (
              navigator.navigatorOptions.handles?.enabled &&
              Object.keys(navigator.handles).length === navigator.handles.length
            ) {
              navigator.drawHandle(zoomedMin, 0, inverted, verb);
              navigator.drawHandle(zoomedMax, 1, inverted, verb);
            }
          }
        }
        removeEvents() {
          this.eventsToUnbind?.forEach((unbind) => {
            unbind();
          });
          this.eventsToUnbind = void 0;
          this.removeBaseSeriesEvents();
        }
        removeBaseSeriesEvents() {
          const baseSeries = this.baseSeries || [];
          if (this.navigatorEnabled && baseSeries[0]) {
            if (this.navigatorOptions.adaptToUpdatedData !== false) {
              baseSeries.forEach(function (series) {
                removeEvent(series, 'updatedData', this.updatedDataHandler);
              }, this);
            }
            if (baseSeries[0].xAxis) {
              removeEvent(
                baseSeries[0].xAxis,
                'foundExtremes',
                this.modifyBaseAxisExtremes,
              );
            }
          }
        }
        getXAxisOffsets() {
          return this.chart.inverted
            ? [this.scrollButtonSize, 0, -this.scrollButtonSize, 0]
            : [0, -this.scrollButtonSize, 0, this.scrollButtonSize];
        }
        init(chart) {
          const chartOptions = chart.options,
            navigatorOptions = chartOptions.navigator || {},
            navigatorEnabled = navigatorOptions.enabled,
            scrollbarOptions = chartOptions.scrollbar || {},
            scrollbarEnabled = scrollbarOptions.enabled,
            height = (navigatorEnabled && navigatorOptions.height) || 0,
            scrollbarHeight =
              (scrollbarEnabled && scrollbarOptions.height) || 0,
            scrollButtonSize =
              (scrollbarOptions.buttonsEnabled && scrollbarHeight) || 0;
          this.handles = [];
          this.shades = [];
          this.chart = chart;
          this.setBaseSeries();
          this.height = height;
          this.scrollbarHeight = scrollbarHeight;
          this.scrollButtonSize = scrollButtonSize;
          this.scrollbarEnabled = scrollbarEnabled;
          this.navigatorEnabled = !!navigatorEnabled;
          this.navigatorOptions = navigatorOptions;
          this.scrollbarOptions = scrollbarOptions;
          this.setOpposite();
          const navigator = this,
            baseSeries = navigator.baseSeries,
            xAxisIndex = chart.xAxis.length,
            yAxisIndex = chart.yAxis.length,
            baseXaxis = (baseSeries && baseSeries[0] && baseSeries[0].xAxis) ||
              chart.xAxis[0] || { options: {} };
          chart.isDirtyBox = true;
          if (navigator.navigatorEnabled) {
            const offsets = this.getXAxisOffsets();
            navigator.xAxis =
              new (highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_default())(
                chart,
                merge(
                  {
                    breaks: baseXaxis.options.breaks,
                    ordinal: baseXaxis.options.ordinal,
                    overscroll: baseXaxis.options.overscroll,
                  },
                  navigatorOptions.xAxis,
                  {
                    type: 'datetime',
                    yAxis: navigatorOptions.yAxis?.id,
                    index: xAxisIndex,
                    isInternal: true,
                    offset: 0,
                    keepOrdinalPadding: true,
                    startOnTick: false,
                    endOnTick: false,
                    minPadding: baseXaxis.options.ordinal
                      ? 0
                      : baseXaxis.options.minPadding,
                    maxPadding: baseXaxis.options.ordinal
                      ? 0
                      : baseXaxis.options.maxPadding,
                    zoomEnabled: false,
                  },
                  chart.inverted
                    ? {
                        offsets,
                        width: height,
                      }
                    : {
                        offsets,
                        height,
                      },
                ),
                'xAxis',
              );
            navigator.yAxis =
              new (highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_default())(
                chart,
                merge(
                  navigatorOptions.yAxis,
                  {
                    alignTicks: false,
                    offset: 0,
                    index: yAxisIndex,
                    isInternal: true,
                    reversed: pick(
                      navigatorOptions.yAxis && navigatorOptions.yAxis.reversed,
                      chart.yAxis[0] && chart.yAxis[0].reversed,
                      false,
                    ),
                    zoomEnabled: false,
                  },
                  chart.inverted
                    ? {
                        width: height,
                      }
                    : {
                        height: height,
                      },
                ),
                'yAxis',
              );
            if (baseSeries || navigatorOptions.series?.data) {
              navigator.updateNavigatorSeries(false);
            } else if (chart.series.length === 0) {
              navigator.unbindRedraw = addEvent(
                chart,
                'beforeRedraw',
                function () {
                  if (chart.series.length > 0 && !navigator.series) {
                    navigator.setBaseSeries();
                    navigator.unbindRedraw?.();
                  }
                },
              );
            }
            navigator.reversedExtremes =
              (chart.inverted && !navigator.xAxis.reversed) ||
              (!chart.inverted && navigator.xAxis.reversed);
            navigator.renderElements();
            navigator.addMouseEvents();
          } else {
            navigator.xAxis = {
              chart,
              navigatorAxis: {
                fake: true,
              },
              translate: function (value, reverse) {
                const axis = chart.xAxis[0],
                  ext = axis.getExtremes(),
                  scrollTrackWidth = axis.len - 2 * scrollButtonSize,
                  min = numExt('min', axis.options.min, ext.dataMin),
                  valueRange =
                    numExt('max', axis.options.max, ext.dataMax) - min;
                return reverse
                  ?
                    (value * valueRange) / scrollTrackWidth + min
                  :
                    (scrollTrackWidth * (value - min)) / valueRange;
              },
              toPixels: function (value) {
                return this.translate(value);
              },
              toValue: function (value) {
                return this.translate(value, true);
              },
            };
            navigator.xAxis.navigatorAxis.axis = navigator.xAxis;
            navigator.xAxis.navigatorAxis.toFixedRange =
              NavigatorAxisComposition.prototype.toFixedRange.bind(
                navigator.xAxis.navigatorAxis,
              );
          }
          if (chart.options.scrollbar?.enabled) {
            const options = merge(chart.options.scrollbar, {
              vertical: chart.inverted,
            });
            if (!isNumber(options.margin)) {
              options.margin = chart.inverted ? -3 : 3;
            }
            chart.scrollbar = navigator.scrollbar = new Scrollbar_Scrollbar(
              chart.renderer,
              options,
              chart,
            );
            addEvent(navigator.scrollbar, 'changed', function (e) {
              const range = navigator.size,
                to = range * this.to,
                from = range * this.from;
              navigator.hasDragged = navigator.scrollbar?.hasDragged;
              navigator.render(0, 0, from, to);
              if (this.shouldUpdateExtremes(e.DOMType)) {
                setTimeout(function () {
                  navigator.onMouseUp(e);
                });
              }
            });
          }
          navigator.addBaseSeriesEvents();
          navigator.addChartEvents();
        }
        setOpposite() {
          const navigatorOptions = this.navigatorOptions,
            navigatorEnabled = this.navigatorEnabled,
            chart = this.chart;
          this.opposite = pick(
            navigatorOptions.opposite,
            Boolean(!navigatorEnabled && chart.inverted),
          );
        }
        getUnionExtremes(returnFalseOnNoBaseSeries) {
          const baseAxis = this.chart.xAxis[0],
            time = this.chart.time,
            navAxis = this.xAxis,
            navAxisOptions = navAxis.options,
            baseAxisOptions = baseAxis.options;

          // v11 兼容性：为 time.parse 添加 polyfill
          const safeTimeParse = (value) => {
            if (value == null) return;
            if (typeof value === 'number') return value;
            // 如果 time.parse 存在，使用它；否则降级到 Date.parse
            if (time && typeof time.parse === 'function') {
              return time.parse(value);
            }
            // 降级方案：使用 Date.parse
            const result = Date.parse(value);
            return !isNaN(result) ? result : void 0;
          };

          let ret;
          if (!returnFalseOnNoBaseSeries || baseAxis.dataMin !== null) {
            ret = {
              dataMin: pick(
                safeTimeParse(navAxisOptions?.min),
                numExt(
                  'min',
                  safeTimeParse(baseAxisOptions.min),
                  baseAxis.dataMin,
                  navAxis.dataMin,
                  navAxis.min,
                ),
              ),
              dataMax: pick(
                safeTimeParse(navAxisOptions?.max),
                numExt(
                  'max',
                  safeTimeParse(baseAxisOptions.max),
                  baseAxis.dataMax,
                  navAxis.dataMax,
                  navAxis.max,
                ),
              ),
            };
          }
          return ret;
        }
        setBaseSeries(baseSeriesOptions, redraw) {
          const chart = this.chart,
            baseSeries = (this.baseSeries = []);
          baseSeriesOptions =
            baseSeriesOptions ||
            chart.options.navigator?.baseSeries ||
            (chart.series.length
              ?
                find(chart.series, (s) => !s.options.isInternal).index
              : 0);
          (chart.series || []).forEach((series, i) => {
            if (
              !series.options.isInternal &&
              (series.options.showInNavigator ||
                ((i === baseSeriesOptions ||
                  series.options.id === baseSeriesOptions) &&
                  series.options.showInNavigator !== false))
            ) {
              baseSeries.push(series);
            }
          });
          if (this.xAxis && !this.xAxis.navigatorAxis.fake) {
            this.updateNavigatorSeries(true, redraw);
          }
        }
        updateNavigatorSeries(addEvents, redraw) {
          const navigator = this,
            chart = navigator.chart,
            baseSeries = navigator.baseSeries,
            navSeriesMixin = {
              enableMouseTracking: false,
              index: null,
              linkedTo: null,
              group: 'nav',
              padXAxis: false,
              xAxis: this.navigatorOptions.xAxis?.id,
              yAxis: this.navigatorOptions.yAxis?.id,
              showInLegend: false,
              stacking: void 0,
              isInternal: true,
              states: {
                inactive: {
                  opacity: 1,
                },
              },
            },
            navigatorSeries = (navigator.series = (
              navigator.series || []
            ).filter((navSeries) => {
              const base = navSeries.baseSeries;
              if (base && baseSeries.indexOf(base) < 0) {
                if (base) {
                  removeEvent(
                    base,
                    'updatedData',
                    navigator.updatedDataHandler,
                  );
                  delete base.navigatorSeries;
                }
                if (navSeries.chart) {
                  navSeries.destroy();
                }
                return false;
              }
              return true;
            }));
          let baseOptions,
            mergedNavSeriesOptions,
            chartNavigatorSeriesOptions = navigator.navigatorOptions.series,
            baseNavigatorOptions;
          if (baseSeries && baseSeries.length) {
            baseSeries.forEach((base) => {
              const linkedNavSeries = base.navigatorSeries,
                userNavOptions = extend(
                  {
                    color: base.color,
                    visible: base.visible,
                  },
                  !isArray(chartNavigatorSeriesOptions)
                    ? chartNavigatorSeriesOptions
                    : Navigator_defaultOptions.navigator.series,
                );
              if (
                linkedNavSeries &&
                navigator.navigatorOptions.adaptToUpdatedData === false
              ) {
                return;
              }
              navSeriesMixin.name = 'Navigator ' + baseSeries.length;
              baseOptions = base.options || {};
              baseNavigatorOptions = baseOptions.navigatorOptions || {};
              userNavOptions.dataLabels = splat(userNavOptions.dataLabels);
              mergedNavSeriesOptions = merge(
                baseOptions,
                navSeriesMixin,
                userNavOptions,
                baseNavigatorOptions,
              );
              mergedNavSeriesOptions.pointRange = pick(
                userNavOptions.pointRange,
                baseNavigatorOptions.pointRange,
                Navigator_defaultOptions.plotOptions[
                  mergedNavSeriesOptions.type || 'line'
                ]?.pointRange,
              );
              const navigatorSeriesData =
                baseNavigatorOptions.data || userNavOptions.data;
              navigator.hasNavigatorData =
                navigator.hasNavigatorData || !!navigatorSeriesData;
              mergedNavSeriesOptions.data =
                navigatorSeriesData || baseOptions.data?.slice(0);
              if (linkedNavSeries && linkedNavSeries.options) {
                linkedNavSeries.update(mergedNavSeriesOptions, redraw);
              } else {
                base.navigatorSeries = chart.initSeries(mergedNavSeriesOptions);
                chart.setSortedData();
                base.navigatorSeries.baseSeries = base;
                navigatorSeries.push(base.navigatorSeries);
              }
            });
          }
          if (
            (chartNavigatorSeriesOptions?.data &&
              !(baseSeries && baseSeries.length)) ||
            isArray(chartNavigatorSeriesOptions)
          ) {
            navigator.hasNavigatorData = false;
            chartNavigatorSeriesOptions = splat(chartNavigatorSeriesOptions);
            chartNavigatorSeriesOptions.forEach((userSeriesOptions, i) => {
              navSeriesMixin.name = 'Navigator ' + (navigatorSeries.length + 1);
              mergedNavSeriesOptions = merge(
                Navigator_defaultOptions.navigator?.series,
                {
                  // an explicit color as otherwise updates will increment
                  color:
                    (chart.series[i] &&
                      !chart.series[i].options.isInternal &&
                      chart.series[i].color) ||
                    chart.options.colors?.[i] ||
                    chart.options.colors?.[0],
                },
                navSeriesMixin,
                userSeriesOptions,
              );
              mergedNavSeriesOptions.data = userSeriesOptions.data;
              if (mergedNavSeriesOptions.data) {
                navigator.hasNavigatorData = true;
                navigatorSeries.push(chart.initSeries(mergedNavSeriesOptions));
              }
            });
          }
          if (addEvents) {
            this.addBaseSeriesEvents();
          }
        }
        addBaseSeriesEvents() {
          const navigator = this,
            baseSeries = navigator.baseSeries || [];
          if (baseSeries[0] && baseSeries[0].xAxis) {
            baseSeries[0].eventsToUnbind.push(
              addEvent(
                baseSeries[0].xAxis,
                'foundExtremes',
                this.modifyBaseAxisExtremes,
              ),
            );
          }
          baseSeries.forEach((base) => {
            base.eventsToUnbind.push(
              addEvent(base, 'show', function () {
                if (this.navigatorSeries) {
                  this.navigatorSeries.setVisible(true, false);
                }
              }),
            );
            base.eventsToUnbind.push(
              addEvent(base, 'hide', function () {
                if (this.navigatorSeries) {
                  this.navigatorSeries.setVisible(false, false);
                }
              }),
            );
            if (this.navigatorOptions.adaptToUpdatedData !== false) {
              if (base.xAxis) {
                base.eventsToUnbind.push(
                  addEvent(base, 'updatedData', this.updatedDataHandler),
                );
              }
            }
            base.eventsToUnbind.push(
              addEvent(base, 'remove', function () {
                if (baseSeries) {
                  erase(baseSeries, base);
                }
                if (this.navigatorSeries && navigator.series) {
                  erase(navigator.series, this.navigatorSeries);
                  if (defined(this.navigatorSeries.options)) {
                    this.navigatorSeries.remove(false);
                  }
                  delete this.navigatorSeries;
                }
              }),
            );
          });
        }
        getBaseSeriesMin(currentSeriesMin) {
          return this.baseSeries.reduce(function (min, series) {
            return Math.min(min, series.getColumn('x')[0] ?? min);
          }, currentSeriesMin);
        }
        modifyNavigatorAxisExtremes() {
          const xAxis = this.xAxis;
          if (typeof xAxis.getExtremes !== 'undefined') {
            const unionExtremes = this.getUnionExtremes(true);
            if (
              unionExtremes &&
              (unionExtremes.dataMin !== xAxis.min ||
                unionExtremes.dataMax !== xAxis.max)
            ) {
              xAxis.min = unionExtremes.dataMin;
              xAxis.max = unionExtremes.dataMax;
            }
          }
        }
        modifyBaseAxisExtremes() {
          const baseXAxis = this,
            navigator = baseXAxis.chart.navigator,
            baseExtremes = baseXAxis.getExtremes(),
            baseMin = baseExtremes.min,
            baseMax = baseExtremes.max,
            baseDataMin = baseExtremes.dataMin,
            baseDataMax = baseExtremes.dataMax,
            range = baseMax - baseMin,
            stickToMin = navigator?.stickToMin,
            stickToMax = navigator?.stickToMax,
            overscroll = pick(
              baseXAxis.ordinal?.convertOverscroll(
                baseXAxis.options.overscroll,
              ),
              0,
            ),
            navigatorSeries = navigator.series && navigator.series[0],
            hasSetExtremes = !!baseXAxis.setExtremes,
            unmutable =
              baseXAxis.eventArgs &&
              baseXAxis.eventArgs.trigger === 'rangeSelectorButton';
          let newMax, newMin;
          if (!unmutable) {
            if (stickToMin) {
              newMin = baseDataMin;
              newMax = newMin + range;
            }
            if (stickToMax) {
              newMax = baseDataMax + overscroll;
              if (!stickToMin) {
                newMin = Math.max(
                  baseDataMin,
                  newMax - range,
                  navigator.getBaseSeriesMin(
                    navigatorSeries && navigatorSeries.xData
                      ? navigatorSeries.xData[0]
                      : -Number.MAX_VALUE,
                  ),
                );
              }
            }
            if (hasSetExtremes && (stickToMin || stickToMax)) {
              if (isNumber(newMin)) {
                baseXAxis.min = baseXAxis.userMin = newMin;
                baseXAxis.max = baseXAxis.userMax = newMax;
              }
            }
          }
          navigator.stickToMin = navigator.stickToMax = null;
        }
        updatedDataHandler() {
          const navigator = this.chart.navigator,
            baseSeries = this,
            navigatorSeries = this.navigatorSeries,
            shouldStickToMax = navigator.reversedExtremes
              ? Math.round(navigator.zoomedMin) === 0
              : Math.round(navigator.zoomedMax) >= Math.round(navigator.size);
          navigator.stickToMax = pick(
            this.chart.options.navigator &&
              this.chart.options.navigator.stickToMax,
            shouldStickToMax,
          );
          navigator.stickToMin = navigator.shouldStickToMin(
            baseSeries,
            navigator,
          );
          if (navigatorSeries && !navigator.hasNavigatorData) {
            navigatorSeries.options.pointStart = baseSeries.getColumn('x')[0];
            navigatorSeries.setData(
              baseSeries.options.data,
              false,
              void 0,
              false,
            );
          }
        }
        shouldStickToMin(baseSeries, navigator) {
          const xDataMin = navigator.getBaseSeriesMin(
              baseSeries.getColumn('x')[0],
            ),
            xAxis = baseSeries.xAxis,
            max = xAxis.max,
            min = xAxis.min,
            range = xAxis.options.range;
          let stickToMin = true;
          if (isNumber(max) && isNumber(min)) {
            if (range && max - xDataMin > 0) {
              stickToMin = max - xDataMin < range;
            } else {
              stickToMin = min <= xDataMin;
            }
          } else {
            stickToMin = false;
          }
          return stickToMin;
        }
        addChartEvents() {
          if (!this.eventsToUnbind) {
            this.eventsToUnbind = [];
          }
          this.eventsToUnbind.push(
            addEvent(this.chart, 'redraw', function () {
              const navigator = this.navigator,
                xAxis =
                  navigator &&
                  ((navigator.baseSeries &&
                    navigator.baseSeries[0] &&
                    navigator.baseSeries[0].xAxis) ||
                    this.xAxis[0]);
              if (xAxis) {
                navigator.render(xAxis.min, xAxis.max);
              }
            }),
            addEvent(this.chart, 'getMargins', function () {
              const chart = this,
                navigator = chart.navigator;
              let marginName = navigator.opposite ? 'plotTop' : 'marginBottom';
              if (chart.inverted) {
                marginName = navigator.opposite ? 'marginRight' : 'plotLeft';
              }
              chart[marginName] =
                (chart[marginName] || 0) +
                (navigator.navigatorEnabled || !chart.inverted
                  ? navigator.height +
                    (this.scrollbar?.options.margin || 0) +
                    navigator.scrollbarHeight
                  : 0) +
                (navigator.navigatorOptions.margin || 0);
            }),
            addEvent(this, 'setRange', function (e) {
              this.chart.xAxis[0].setExtremes(
                e.min,
                e.max,
                e.redraw,
                e.animation,
                e.eventArguments,
              );
            }),
          );
        }
        destroy() {
          this.removeEvents();
          if (this.xAxis) {
            erase(this.chart.xAxis, this.xAxis);
            erase(this.chart.axes, this.xAxis);
          }
          if (this.yAxis) {
            erase(this.chart.yAxis, this.yAxis);
            erase(this.chart.axes, this.yAxis);
          }
          (this.series || []).forEach((s) => {
            if (s.destroy) {
              s.destroy();
            }
          });
          [
            'series',
            'xAxis',
            'yAxis',
            'shades',
            'outline',
            'scrollbarTrack',
            'scrollbarRifles',
            'scrollbarGroup',
            'scrollbar',
            'navigatorGroup',
            'rendered',
          ].forEach((prop) => {
            if (this[prop] && this[prop].destroy) {
              this[prop].destroy();
            }
            this[prop] = null;
          });
          [this.handles].forEach((coll) => {
            destroyObjectProperties(coll);
          });
          this.baseSeries.forEach((s) => {
            s.navigatorSeries = void 0;
          });
          this.navigatorEnabled = false;
        }
      }
       const Navigator_Navigator = Navigator;


      const standaloneNavigatorDefaults = {
        chart: {
          height: 70,
          margin: [0, 5, 0, 5],
        },
        exporting: {
          enabled: false,
        },
        legend: {
          enabled: false,
        },
        navigator: {
          enabled: false,
        },
        plotOptions: {
          series: {
            states: {
              hover: {
                enabled: false,
              },
            },
            marker: {
              enabled: false,
            },
          },
        },
        scrollbar: {
          enabled: false,
        },
        title: {
          text: '',
        },
        tooltip: {
          enabled: false,
        },
        xAxis: {
          visible: false,
        },
        yAxis: {
          height: 0,
          visible: false,
        },
      };
       const StandaloneNavigatorDefaults =
        standaloneNavigatorDefaults;


      class StandaloneNavigator {
        static navigator(renderTo, options) {
          const nav = new StandaloneNavigator(renderTo, options);
          if (
            !highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default()
              .navigators
          ) {
            highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default().navigators =
              [nav];
          } else {
            highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default().navigators.push(
              nav,
            );
          }
          return nav;
        }
        constructor(element, userOptions) {
          this.boundAxes = [];
          this.userOptions = userOptions;
          this.chartOptions = merge(
            highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default().getOptions(),
            StandaloneNavigatorDefaults,
            userOptions.chart,
            { navigator: userOptions },
          );
          if (this.chartOptions.chart && userOptions.height) {
            this.chartOptions.chart.height = userOptions.height;
          }
          const chart =
            new (highcharts_Chart_commonjs_highcharts_Chart_commonjs2_highcharts_Chart_root_Highcharts_Chart_default())(
              element,
              this.chartOptions,
            );
          chart.options = merge(chart.options, {
            navigator: { enabled: true },
            scrollbar: { enabled: true },
          });
          if (this.chartOptions.navigator && this.chartOptions.scrollbar) {
            this.chartOptions.navigator.enabled = true;
            this.chartOptions.scrollbar.enabled = true;
          }
          this.navigator = new Navigator_Navigator(chart);
          chart.navigator = this.navigator;
          this.initNavigator();
        }
        bind(axisOrChart, twoWay = true) {
          const nav = this;
          const axis =
            axisOrChart instanceof
            highcharts_Chart_commonjs_highcharts_Chart_commonjs2_highcharts_Chart_root_Highcharts_Chart_default()
              ? axisOrChart.xAxis[0]
              : axisOrChart;
          if (
            !(
              axis instanceof
              highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_default()
            )
          ) {
            return;
          }
          const { min, max } = this.navigator.xAxis,
            removeEventCallbacks = [];
          if (twoWay) {
            const removeSetExtremesEvent = addEvent(
              axis,
              'setExtremes',
              (e) => {
                if (
                  e.trigger === 'pan' ||
                  e.trigger === 'zoom' ||
                  e.trigger === 'mousewheel' ||
                  e.trigger === 'rangeSelectorButton' ||
                  e.trigger === 'rangeSelectorInput'
                ) {
                  nav.setRange(
                    e.min,
                    e.max,
                    true,
                    e.trigger !== 'pan' && e.trigger !== 'mousewheel',
                    { trigger: axis },
                  );
                }
              },
            );
            removeEventCallbacks.push(removeSetExtremesEvent);
          }
          const removeSetRangeEvent = addEvent(
            this.navigator,
            'setRange',
            (e) => {
              axis.setExtremes(e.min, e.max, e.redraw, e.animation);
            },
          );
          removeEventCallbacks.push(removeSetRangeEvent);
          let boundAxis = this.boundAxes.filter(function (boundAxis) {
            return boundAxis.axis === axis;
          })[0];
          if (!boundAxis) {
            boundAxis = { axis, callbacks: [] };
            this.boundAxes.push(boundAxis);
          }
          boundAxis.callbacks = removeEventCallbacks;
          axis.series.forEach((series) => {
            if (series.options.showInNavigator) {
              nav.addSeries(series.options);
            }
          });
          axis.setExtremes(min, max);
          addEvent(axis, 'destroy', (e) => {
            if (!e.keepEvents) {
              this.unbind(axis);
            }
          });
        }
        unbind(axisOrChart) {
          if (!axisOrChart) {
            this.boundAxes.forEach(({ callbacks }) => {
              callbacks.forEach((removeCallback) => removeCallback());
            });
            this.boundAxes.length = 0;
            return;
          }
          const axis =
            axisOrChart instanceof
            highcharts_Axis_commonjs_highcharts_Axis_commonjs2_highcharts_Axis_root_Highcharts_Axis_default()
              ? axisOrChart
              : axisOrChart.xAxis[0];
          for (let i = this.boundAxes.length - 1; i >= 0; i--) {
            if (this.boundAxes[i].axis === axis) {
              this.boundAxes[i].callbacks.forEach((callback) => callback());
              this.boundAxes.splice(i, 1);
            }
          }
        }
        destroy() {
          this.boundAxes.forEach(({ callbacks }) => {
            callbacks.forEach((removeCallback) => removeCallback());
          });
          this.boundAxes.length = 0;
          this.navigator.destroy();
          this.navigator.chart.destroy();
        }
        update(newOptions, redraw) {
          this.chartOptions = merge(
            this.chartOptions,
            newOptions.height && { chart: { height: newOptions.height } },
            newOptions.chart,
            { navigator: newOptions },
          );
          this.navigator.chart.update(this.chartOptions, redraw);
        }
        redraw() {
          this.navigator.chart.redraw();
        }
        addSeries(seriesOptions) {
          this.navigator.chart.addSeries(
            merge(seriesOptions, {
              showInNavigator: pick(seriesOptions.showInNavigator, true),
            }),
          );
          this.navigator.setBaseSeries();
        }
        initNavigator() {
          const nav = this.navigator;
          nav.top = 1;
          nav.xAxis.setScale();
          nav.yAxis.setScale();
          nav.xAxis.render();
          nav.yAxis.render();
          nav.series?.forEach((s) => {
            s.translate();
            s.render();
            s.redraw();
          });
          const { min, max } = this.getInitialExtremes();
          nav.chart.xAxis[0].userMin = min;
          nav.chart.xAxis[0].userMax = max;
          nav.render(min, max);
        }
        getRange() {
          const { min, max } = this.navigator.chart.xAxis[0].getExtremes(),
            {
              userMin,
              userMax,
              min: dataMin,
              max: dataMax,
            } = this.navigator.xAxis.getExtremes();
          return {
            min: pick(min, dataMin),
            max: pick(max, dataMax),
            dataMin,
            dataMax,
            userMin,
            userMax,
          };
        }
        setRange(min, max, redraw, animation, eventArguments) {
          fireEvent(this.navigator, 'setRange', {
            min,
            max,
            redraw,
            animation,
            eventArguments: merge(eventArguments, { trigger: 'navigator' }),
          });
        }
        getInitialExtremes() {
          const { min, max } = this.navigator.xAxis.getExtremes();
          return {
            min: min,
            max: max,
          };
        }
      }
       const Navigator_StandaloneNavigator =
        StandaloneNavigator;
      ('');

      const G =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();
      G.StandaloneNavigator =
        G.StandaloneNavigator || Navigator_StandaloneNavigator;
      G.navigator = G.StandaloneNavigator.navigator;
      Navigator_NavigatorComposition.compose(G.Chart, G.Axis, G.Series);
       const navigator_src =
        highcharts_commonjs_highcharts_commonjs2_highcharts_root_Highcharts_default();

      __webpack_exports__ = __webpack_exports__['default'];
       return __webpack_exports__;
    })();
  },
);

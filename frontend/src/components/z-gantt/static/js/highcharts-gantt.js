/*
 Highcharts Gantt JS v11.1.0 (2023-06-09)

 (c) 2017-2021 Lars Cabrera, Torstein Honsi, Jon Arild Nygard & Oystein Moseng

 License: www.highcharts.com/license
*/
'use strict';
(function (U, M) {
  'object' === typeof module && module.exports
    ? ((M['default'] = M), (module.exports = U.document ? M(U) : M))
    : 'function' === typeof define && define.amd
      ? define('highcharts/highcharts-gantt', function () {
          return M(U);
        })
      : (U.Highcharts && U.Highcharts.error(16, !0), (U.Highcharts = M(U)));
})('undefined' !== typeof window ? window : this, function (U) {
  function M(a, A, G, H) {
    a.hasOwnProperty(A) ||
      ((a[A] = H.apply(null, G)),
      'function' === typeof CustomEvent &&
        U.dispatchEvent(
          new CustomEvent('HighchartsModuleLoaded', {
            detail: { path: A, module: a[A] },
          }),
        ));
  }
  var a = {};
  M(a, 'Core/Globals.js', [], function () {
    var a;
    (function (a) {
      a.SVG_NS = 'http://www.w3.org/2000/svg';
      a.product = 'Highcharts';
      a.version = '11.1.0';
      a.win = 'undefined' !== typeof U ? U : {};
      a.doc = a.win.document;
      a.svg =
        a.doc &&
        a.doc.createElementNS &&
        !!a.doc.createElementNS(a.SVG_NS, 'svg').createSVGRect;
      a.userAgent = (a.win.navigator && a.win.navigator.userAgent) || '';
      a.isChrome = -1 !== a.userAgent.indexOf('Chrome');
      a.isFirefox = -1 !== a.userAgent.indexOf('Firefox');
      a.isMS = /(edge|msie|trident)/i.test(a.userAgent) && !a.win.opera;
      a.isSafari = !a.isChrome && -1 !== a.userAgent.indexOf('Safari');
      a.isTouchDevice = /(Mobile|Android|Windows Phone)/.test(a.userAgent);
      a.isWebKit = -1 !== a.userAgent.indexOf('AppleWebKit');
      a.deg2rad = (2 * Math.PI) / 360;
      a.hasBidiBug =
        a.isFirefox && 4 > parseInt(a.userAgent.split('Firefox/')[1], 10);
      a.hasTouch = !!a.win.TouchEvent;
      a.marginNames = ['plotTop', 'marginRight', 'marginBottom', 'plotLeft'];
      a.noop = function () {};
      a.supportsPassiveEvents = (function () {
        let x = !1;
        if (!a.isMS) {
          const A = Object.defineProperty({}, 'passive', {
            get: function () {
              x = !0;
            },
          });
          a.win.addEventListener &&
            a.win.removeEventListener &&
            (a.win.addEventListener('testPassive', a.noop, A),
            a.win.removeEventListener('testPassive', a.noop, A));
        }
        return x;
      })();
      a.charts = [];
      a.dateFormats = {};
      a.seriesTypes = {};
      a.symbolSizes = {};
      a.chartCount = 0;
    })(a || (a = {}));
    ('');
    return a;
  });
  M(a, 'Core/Utilities.js', [a['Core/Globals.js']], function (a) {
    function x(c, b, e, p) {
      const l = b ? 'Highcharts error' : 'Highcharts warning';
      32 === c && (c = `${l}: Deprecated member`);
      const I = u(c);
      let t = I ? `${l} #${c}: www.highcharts.com/errors/${c}/` : c.toString();
      if ('undefined' !== typeof p) {
        let c = '';
        I && (t += '?');
        K(p, function (b, l) {
          c += `\n - ${l}: ${b}`;
          I && (t += encodeURI(l) + '=' + encodeURI(b));
        });
        t += c;
      }
      f(
        a,
        'displayError',
        { chart: e, code: c, message: t, params: p },
        function () {
          if (b) throw Error(t);
          n.console && -1 === x.messages.indexOf(t) && console.warn(t);
        },
      );
      x.messages.push(t);
    }
    function G(c, b) {
      return parseInt(c, b || 10);
    }
    function H(c) {
      return 'string' === typeof c;
    }
    function C(c) {
      c = Object.prototype.toString.call(c);
      return '[object Array]' === c || '[object Array Iterator]' === c;
    }
    function z(c, b) {
      return !!c && 'object' === typeof c && (!b || !C(c));
    }
    function D(c) {
      return z(c) && 'number' === typeof c.nodeType;
    }
    function B(c) {
      const b = c && c.constructor;
      return !(!z(c, !0) || D(c) || !b || !b.name || 'Object' === b.name);
    }
    function u(c) {
      return (
        'number' === typeof c && !isNaN(c) && Infinity > c && -Infinity < c
      );
    }
    function q(c) {
      return 'undefined' !== typeof c && null !== c;
    }
    function r(c, b, e) {
      const l = H(b) && !q(e);
      let f;
      const n = (b, e) => {
        q(b)
          ? c.setAttribute(e, b)
          : l
            ? (f = c.getAttribute(e)) ||
              'class' !== e ||
              (f = c.getAttribute(e + 'Name'))
            : c.removeAttribute(e);
      };
      H(b) ? n(e, b) : K(b, n);
      return f;
    }
    function m(c) {
      return C(c) ? c : [c];
    }
    function v(c, b) {
      let e;
      c || (c = {});
      for (e in b) c[e] = b[e];
      return c;
    }
    function h() {
      const c = arguments,
        b = c.length;
      for (let e = 0; e < b; e++) {
        const b = c[e];
        if ('undefined' !== typeof b && null !== b) return b;
      }
    }
    function g(c, b) {
      a.isMS &&
        !a.svg &&
        b &&
        q(b.opacity) &&
        (b.filter = `alpha(opacity=${100 * b.opacity})`);
      v(c.style, b);
    }
    function d(c) {
      return Math.pow(10, Math.floor(Math.log(c) / Math.LN10));
    }
    function k(c, b) {
      return 1e14 < c ? c : parseFloat(c.toPrecision(b || 14));
    }
    function y(c, b, e) {
      let l;
      if ('width' === b)
        return (
          (b = Math.min(c.offsetWidth, c.scrollWidth)),
          (e = c.getBoundingClientRect && c.getBoundingClientRect().width),
          e < b && e >= b - 1 && (b = Math.floor(e)),
          Math.max(
            0,
            b -
              (y(c, 'padding-left', !0) || 0) -
              (y(c, 'padding-right', !0) || 0),
          )
        );
      if ('height' === b)
        return Math.max(
          0,
          Math.min(c.offsetHeight, c.scrollHeight) -
            (y(c, 'padding-top', !0) || 0) -
            (y(c, 'padding-bottom', !0) || 0),
        );
      if ((c = n.getComputedStyle(c, void 0)))
        ((l = c.getPropertyValue(b)), h(e, 'opacity' !== b) && (l = G(l)));
      return l;
    }
    function K(c, b, e) {
      for (const l in c)
        Object.hasOwnProperty.call(c, l) && b.call(e || c[l], c[l], l, c);
    }
    function L(c, b, e) {
      function l(b, e) {
        const l = c.removeEventListener;
        l && l.call(c, b, e, !1);
      }
      function f(e) {
        let f, J;
        c.nodeName &&
          (b ? ((f = {}), (f[b] = !0)) : (f = e),
          K(f, function (c, b) {
            if (e[b]) for (J = e[b].length; J--; ) l(b, e[b][J].fn);
          }));
      }
      var n = ('function' === typeof c && c.prototype) || c;
      if (Object.hasOwnProperty.call(n, 'hcEvents')) {
        const c = n.hcEvents;
        b
          ? ((n = c[b] || []),
            e
              ? ((c[b] = n.filter(function (c) {
                  return e !== c.fn;
                })),
                l(b, e))
              : (f(c), (c[b] = [])))
          : (f(c), delete n.hcEvents);
      }
    }
    function f(c, b, e, f) {
      e = e || {};
      if (t.createEvent && (c.dispatchEvent || (c.fireEvent && c !== a))) {
        var l = t.createEvent('Events');
        l.initEvent(b, !0, !0);
        e = v(l, e);
        c.dispatchEvent ? c.dispatchEvent(e) : c.fireEvent(b, e);
      } else if (c.hcEvents) {
        e.target ||
          v(e, {
            preventDefault: function () {
              e.defaultPrevented = !0;
            },
            target: c,
            type: b,
          });
        l = [];
        let f = c,
          J = !1;
        for (; f.hcEvents; )
          (Object.hasOwnProperty.call(f, 'hcEvents') &&
            f.hcEvents[b] &&
            (l.length && (J = !0), l.unshift.apply(l, f.hcEvents[b])),
            (f = Object.getPrototypeOf(f)));
        J && l.sort((c, b) => c.order - b.order);
        l.forEach((b) => {
          !1 === b.fn.call(c, e) && e.preventDefault();
        });
      }
      f && !e.defaultPrevented && f.call(c, e);
    }
    const { charts: p, doc: t, win: n } = a;
    (x || (x = {})).messages = [];
    Math.easeInOutSine = function (c) {
      return -0.5 * (Math.cos(Math.PI * c) - 1);
    };
    var w = Array.prototype.find
      ? function (c, b) {
          return c.find(b);
        }
      : function (c, b) {
          let e;
          const l = c.length;
          for (e = 0; e < l; e++) if (b(c[e], e)) return c[e];
        };
    K(
      {
        map: 'map',
        each: 'forEach',
        grep: 'filter',
        reduce: 'reduce',
        some: 'some',
      },
      function (c, b) {
        a[b] = function (e) {
          x(32, !1, void 0, { [`Highcharts.${b}`]: `use Array.${c}` });
          return Array.prototype[c].apply(e, [].slice.call(arguments, 1));
        };
      },
    );
    let e;
    const b = (function () {
      const c = Math.random().toString(36).substring(2, 9) + '-';
      let b = 0;
      return function () {
        return 'highcharts-' + (e ? '' : c) + b++;
      };
    })();
    n.jQuery &&
      (n.jQuery.fn.highcharts = function () {
        const c = [].slice.call(arguments);
        if (this[0])
          return c[0]
            ? (new a[H(c[0]) ? c.shift() : 'Chart'](this[0], c[0], c[1]), this)
            : p[r(this[0], 'data-highcharts-chart')];
      });
    w = {
      addEvent: function (c, b, e, f = {}) {
        var l = ('function' === typeof c && c.prototype) || c;
        Object.hasOwnProperty.call(l, 'hcEvents') || (l.hcEvents = {});
        l = l.hcEvents;
        a.Point &&
          c instanceof a.Point &&
          c.series &&
          c.series.chart &&
          (c.series.chart.runTrackerClick = !0);
        const n = c.addEventListener;
        n &&
          n.call(
            c,
            b,
            e,
            a.supportsPassiveEvents
              ? {
                  passive:
                    void 0 === f.passive
                      ? -1 !== b.indexOf('touch')
                      : f.passive,
                  capture: !1,
                }
              : !1,
          );
        l[b] || (l[b] = []);
        l[b].push({
          fn: e,
          order: 'number' === typeof f.order ? f.order : Infinity,
        });
        l[b].sort((c, b) => c.order - b.order);
        return function () {
          L(c, b, e);
        };
      },
      arrayMax: function (c) {
        let b = c.length,
          e = c[0];
        for (; b--; ) c[b] > e && (e = c[b]);
        return e;
      },
      arrayMin: function (c) {
        let b = c.length,
          e = c[0];
        for (; b--; ) c[b] < e && (e = c[b]);
        return e;
      },
      attr: r,
      clamp: function (c, b, e) {
        return c > b ? (c < e ? c : e) : b;
      },
      clearTimeout: function (c) {
        q(c) && clearTimeout(c);
      },
      correctFloat: k,
      createElement: function (c, b, e, f, J) {
        c = t.createElement(c);
        b && v(c, b);
        J && g(c, { padding: '0', border: 'none', margin: '0' });
        e && g(c, e);
        f && f.appendChild(c);
        return c;
      },
      css: g,
      defined: q,
      destroyObjectProperties: function (c, b) {
        K(c, function (e, l) {
          e && e !== b && e.destroy && e.destroy();
          delete c[l];
        });
      },
      diffObjects: function (c, b, e, f) {
        function l(c, b, J, n) {
          const E = e ? b : c;
          K(c, function (e, p) {
            if (!n && f && -1 < f.indexOf(p) && b[p]) {
              e = m(e);
              J[p] = [];
              for (let c = 0; c < Math.max(e.length, b[p].length); c++)
                b[p][c] &&
                  (void 0 === e[c]
                    ? (J[p][c] = b[p][c])
                    : ((J[p][c] = {}), l(e[c], b[p][c], J[p][c], n + 1)));
            } else if (z(e, !0) && !e.nodeType)
              ((J[p] = C(e) ? [] : {}),
                l(e, b[p] || {}, J[p], n + 1),
                0 !== Object.keys(J[p]).length ||
                  ('colorAxis' === p && 0 === n) ||
                  delete J[p]);
            else if (c[p] !== b[p] || (p in c && !(p in b))) J[p] = E[p];
          });
        }
        const n = {};
        l(c, b, n, 0);
        return n;
      },
      discardElement: function (c) {
        c && c.parentElement && c.parentElement.removeChild(c);
      },
      erase: function (c, b) {
        let e = c.length;
        for (; e--; )
          if (c[e] === b) {
            c.splice(e, 1);
            break;
          }
      },
      error: x,
      extend: v,
      extendClass: function (c, b) {
        const e = function () {};
        e.prototype = new c();
        v(e.prototype, b);
        return e;
      },
      find: w,
      fireEvent: f,
      getClosestDistance: function (c, b) {
        const e = !b;
        let l, f, n, p;
        c.forEach((c) => {
          if (1 < c.length)
            for (p = f = c.length - 1; 0 < p; p--)
              ((n = c[p] - c[p - 1]),
                0 > n && !e
                  ? (null === b || void 0 === b ? void 0 : b(), (b = void 0))
                  : n && ('undefined' === typeof l || n < l) && (l = n));
        });
        return l;
      },
      getMagnitude: d,
      getNestedProperty: function (c, b) {
        for (c = c.split('.'); c.length && q(b); ) {
          const e = c.shift();
          if ('undefined' === typeof e || '__proto__' === e) return;
          if ('this' === e) {
            let c;
            z(b) && (c = b['@this']);
            return null !== c && void 0 !== c ? c : b;
          }
          b = b[e];
          if (
            !q(b) ||
            'function' === typeof b ||
            'number' === typeof b.nodeType ||
            b === n
          )
            return;
        }
        return b;
      },
      getStyle: y,
      inArray: function (b, e, f) {
        x(32, !1, void 0, { 'Highcharts.inArray': 'use Array.indexOf' });
        return e.indexOf(b, f);
      },
      insertItem: function (b, e) {
        const c = b.options.index,
          l = e.length;
        let f;
        for (f = b.options.isInternal ? l : 0; f < l + 1; f++)
          if (
            !e[f] ||
            (u(c) && c < h(e[f].options.index, e[f]._i)) ||
            e[f].options.isInternal
          ) {
            e.splice(f, 0, b);
            break;
          }
        return f;
      },
      isArray: C,
      isClass: B,
      isDOMElement: D,
      isFunction: function (b) {
        return 'function' === typeof b;
      },
      isNumber: u,
      isObject: z,
      isString: H,
      keys: function (b) {
        x(32, !1, void 0, { 'Highcharts.keys': 'use Object.keys' });
        return Object.keys(b);
      },
      merge: function () {
        let b,
          e = arguments,
          f = {};
        const n = function (b, c) {
          'object' !== typeof b && (b = {});
          K(c, function (e, l) {
            '__proto__' !== l &&
              'constructor' !== l &&
              (!z(e, !0) || B(e) || D(e)
                ? (b[l] = c[l])
                : (b[l] = n(b[l] || {}, e)));
          });
          return b;
        };
        !0 === e[0] && ((f = e[1]), (e = Array.prototype.slice.call(e, 2)));
        const J = e.length;
        for (b = 0; b < J; b++) f = n(f, e[b]);
        return f;
      },
      normalizeTickInterval: function (b, e, f, n, J) {
        let c = b;
        f = h(f, d(b));
        const l = b / f;
        e ||
          ((e = J
            ? [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
            : [1, 2, 2.5, 5, 10]),
          !1 === n &&
            (1 === f
              ? (e = e.filter(function (b) {
                  return 0 === b % 1;
                }))
              : 0.1 >= f && (e = [1 / f])));
        for (
          n = 0;
          n < e.length &&
          !((c = e[n]),
          (J && c * f >= b) || (!J && l <= (e[n] + (e[n + 1] || e[n])) / 2));
          n++
        );
        return (c = k(c * f, -Math.round(Math.log(0.001) / Math.LN10)));
      },
      objectEach: K,
      offset: function (b) {
        const c = t.documentElement;
        b =
          b.parentElement || b.parentNode
            ? b.getBoundingClientRect()
            : { top: 0, left: 0, width: 0, height: 0 };
        return {
          top: b.top + (n.pageYOffset || c.scrollTop) - (c.clientTop || 0),
          left: b.left + (n.pageXOffset || c.scrollLeft) - (c.clientLeft || 0),
          width: b.width,
          height: b.height,
        };
      },
      pad: function (b, e, f) {
        return (
          Array((e || 2) + 1 - String(b).replace('-', '').length).join(
            f || '0',
          ) + b
        );
      },
      pick: h,
      pInt: G,
      pushUnique: function (b, e) {
        return 0 > b.indexOf(e) && !!b.push(e);
      },
      relativeLength: function (b, e, f) {
        return /%$/.test(b)
          ? (e * parseFloat(b)) / 100 + (f || 0)
          : parseFloat(b);
      },
      removeEvent: L,
      splat: m,
      stableSort: function (b, e) {
        const c = b.length;
        let l, f;
        for (f = 0; f < c; f++) b[f].safeI = f;
        b.sort(function (b, c) {
          l = e(b, c);
          return 0 === l ? b.safeI - c.safeI : l;
        });
        for (f = 0; f < c; f++) delete b[f].safeI;
      },
      syncTimeout: function (b, e, f) {
        if (0 < e) return setTimeout(b, e, f);
        b.call(0, f);
        return -1;
      },
      timeUnits: {
        millisecond: 1,
        second: 1e3,
        minute: 6e4,
        hour: 36e5,
        day: 864e5,
        week: 6048e5,
        month: 24192e5,
        year: 314496e5,
      },
      uniqueKey: b,
      useSerialIds: function (b) {
        return (e = h(b, e));
      },
      wrap: function (b, e, f) {
        const c = b[e];
        b[e] = function () {
          const b = arguments,
            e = this;
          return f.apply(
            this,
            [
              function () {
                return c.apply(e, arguments.length ? arguments : b);
              },
            ].concat([].slice.call(arguments)),
          );
        };
      },
    };
    ('');
    return w;
  });
  M(a, 'Core/Chart/ChartDefaults.js', [], function () {
    return {
      alignThresholds: !1,
      panning: { enabled: !1, type: 'x' },
      styledMode: !1,
      borderRadius: 0,
      colorCount: 10,
      allowMutatingData: !0,
      ignoreHiddenSeries: !0,
      spacing: [10, 10, 15, 10],
      resetZoomButton: {
        theme: { zIndex: 6 },
        position: { align: 'right', x: -10, y: 10 },
      },
      reflow: !0,
      type: 'line',
      zooming: {
        singleTouch: !1,
        resetButton: {
          theme: { zIndex: 6 },
          position: { align: 'right', x: -10, y: 10 },
        },
      },
      width: null,
      height: null,
      borderColor: '#334eff',
      backgroundColor: '#ffffff',
      plotBorderColor: '#cccccc',
    };
  });
  M(
    a,
    'Core/Color/Color.js',
    [a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A) {
      const { isNumber: x, merge: H, pInt: C } = A;
      class z {
        static parse(a) {
          return a ? new z(a) : z.None;
        }
        constructor(D) {
          this.rgba = [NaN, NaN, NaN, NaN];
          this.input = D;
          const B = a.Color;
          if (B && B !== z) return new B(D);
          this.init(D);
        }
        init(a) {
          let B;
          let u;
          if ('object' === typeof a && 'undefined' !== typeof a.stops)
            this.stops = a.stops.map((q) => new z(q[1]));
          else if ('string' === typeof a) {
            this.input = a = z.names[a.toLowerCase()] || a;
            if ('#' === a.charAt(0)) {
              var q = a.length;
              var r = parseInt(a.substr(1), 16);
              7 === q
                ? (B = [(r & 16711680) >> 16, (r & 65280) >> 8, r & 255, 1])
                : 4 === q &&
                  (B = [
                    ((r & 3840) >> 4) | ((r & 3840) >> 8),
                    ((r & 240) >> 4) | (r & 240),
                    ((r & 15) << 4) | (r & 15),
                    1,
                  ]);
            }
            if (!B)
              for (r = z.parsers.length; r-- && !B; )
                ((u = z.parsers[r]), (q = u.regex.exec(a)) && (B = u.parse(q)));
          }
          B && (this.rgba = B);
        }
        get(a) {
          const B = this.input,
            u = this.rgba;
          if ('object' === typeof B && 'undefined' !== typeof this.stops) {
            const q = H(B);
            q.stops = [].slice.call(q.stops);
            this.stops.forEach((r, m) => {
              q.stops[m] = [q.stops[m][0], r.get(a)];
            });
            return q;
          }
          return u && x(u[0])
            ? 'rgb' === a || (!a && 1 === u[3])
              ? 'rgb(' + u[0] + ',' + u[1] + ',' + u[2] + ')'
              : 'a' === a
                ? `${u[3]}`
                : 'rgba(' + u.join(',') + ')'
            : B;
        }
        brighten(a) {
          const B = this.rgba;
          if (this.stops)
            this.stops.forEach(function (u) {
              u.brighten(a);
            });
          else if (x(a) && 0 !== a)
            for (let u = 0; 3 > u; u++)
              ((B[u] += C(255 * a)),
                0 > B[u] && (B[u] = 0),
                255 < B[u] && (B[u] = 255));
          return this;
        }
        setOpacity(a) {
          this.rgba[3] = a;
          return this;
        }
        tweenTo(a, B) {
          const u = this.rgba,
            q = a.rgba;
          if (!x(u[0]) || !x(q[0])) return a.input || 'none';
          a = 1 !== q[3] || 1 !== u[3];
          return (
            (a ? 'rgba(' : 'rgb(') +
            Math.round(q[0] + (u[0] - q[0]) * (1 - B)) +
            ',' +
            Math.round(q[1] + (u[1] - q[1]) * (1 - B)) +
            ',' +
            Math.round(q[2] + (u[2] - q[2]) * (1 - B)) +
            (a ? ',' + (q[3] + (u[3] - q[3]) * (1 - B)) : '') +
            ')'
          );
        }
      }
      z.names = { white: '#ffffff', black: '#000000' };
      z.parsers = [
        {
          regex:
            /rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]?(?:\.[0-9]+)?)\s*\)/,
          parse: function (a) {
            return [C(a[1]), C(a[2]), C(a[3]), parseFloat(a[4], 10)];
          },
        },
        {
          regex:
            /rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/,
          parse: function (a) {
            return [C(a[1]), C(a[2]), C(a[3]), 1];
          },
        },
      ];
      z.None = new z('');
      ('');
      return z;
    },
  );
  M(a, 'Core/Color/Palettes.js', [], function () {
    return {
      colors:
        '#2caffe #544fc5 #00e272 #fe6a35 #6b8abc #d568fb #2ee0ca #fa4b42 #feb56a #91e8e1'.split(
          ' ',
        ),
    };
  });
  M(
    a,
    'Core/Time.js',
    [a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A) {
      const { win: x } = a,
        {
          defined: H,
          error: C,
          extend: z,
          isObject: D,
          merge: B,
          objectEach: u,
          pad: q,
          pick: r,
          splat: m,
          timeUnits: v,
        } = A,
        h = a.isSafari && x.Intl && x.Intl.DateTimeFormat.prototype.formatRange,
        g =
          a.isSafari && x.Intl && !x.Intl.DateTimeFormat.prototype.formatRange;
      class d {
        constructor(k) {
          this.options = {};
          this.variableTimezone = this.useUTC = !1;
          this.Date = x.Date;
          this.getTimezoneOffset = this.timezoneOffsetFunction();
          this.update(k);
        }
        get(k, d) {
          if (this.variableTimezone || this.timezoneOffset) {
            const y = d.getTime(),
              g = y - this.getTimezoneOffset(d);
            d.setTime(g);
            k = d['getUTC' + k]();
            d.setTime(y);
            return k;
          }
          return this.useUTC ? d['getUTC' + k]() : d['get' + k]();
        }
        set(k, d, g) {
          if (this.variableTimezone || this.timezoneOffset) {
            if (
              'Milliseconds' === k ||
              'Seconds' === k ||
              ('Minutes' === k && 0 === this.getTimezoneOffset(d) % 36e5)
            )
              return d['setUTC' + k](g);
            var y = this.getTimezoneOffset(d);
            y = d.getTime() - y;
            d.setTime(y);
            d['setUTC' + k](g);
            k = this.getTimezoneOffset(d);
            y = d.getTime() + k;
            return d.setTime(y);
          }
          return this.useUTC || (h && 'FullYear' === k)
            ? d['setUTC' + k](g)
            : d['set' + k](g);
        }
        update(k = {}) {
          const d = r(k.useUTC, !0);
          this.options = k = B(!0, this.options, k);
          this.Date = k.Date || x.Date || Date;
          this.timezoneOffset =
            ((this.useUTC = d) && k.timezoneOffset) || void 0;
          this.getTimezoneOffset = this.timezoneOffsetFunction();
          this.variableTimezone = d && !(!k.getTimezoneOffset && !k.timezone);
        }
        makeTime(k, d, h, q, f, p) {
          let t, n, w;
          this.useUTC
            ? ((t = this.Date.UTC.apply(0, arguments)),
              (n = this.getTimezoneOffset(t)),
              (t += n),
              (w = this.getTimezoneOffset(t)),
              n !== w
                ? (t += w - n)
                : n - 36e5 !== this.getTimezoneOffset(t - 36e5) ||
                  g ||
                  (t -= 36e5))
            : (t = new this.Date(
                k,
                d,
                r(h, 1),
                r(q, 0),
                r(f, 0),
                r(p, 0),
              ).getTime());
          return t;
        }
        timezoneOffsetFunction() {
          const k = this,
            d = this.options,
            g = d.getTimezoneOffset,
            h = d.moment || x.moment;
          if (!this.useUTC)
            return function (f) {
              return 6e4 * new Date(f.toString()).getTimezoneOffset();
            };
          if (d.timezone) {
            if (h)
              return function (f) {
                return 6e4 * -h.tz(f, d.timezone).utcOffset();
              };
            C(25);
          }
          return this.useUTC && g
            ? function (f) {
                return 6e4 * g(f.valueOf());
              }
            : function () {
                return 6e4 * (k.timezoneOffset || 0);
              };
        }
        dateFormat(d, g, h) {
          if (!H(g) || isNaN(g))
            return (
              (a.defaultOptions.lang && a.defaultOptions.lang.invalidDate) || ''
            );
          d = r(d, '%Y-%m-%d %H:%M:%S');
          const k = this;
          var f = new this.Date(g);
          const p = this.get('Hours', f),
            t = this.get('Day', f),
            n = this.get('Date', f),
            w = this.get('Month', f),
            e = this.get('FullYear', f),
            b = a.defaultOptions.lang,
            c = b && b.weekdays,
            l = b && b.shortWeekdays;
          f = z(
            {
              a: l ? l[t] : c[t].substr(0, 3),
              A: c[t],
              d: q(n),
              e: q(n, 2, ' '),
              w: t,
              b: b.shortMonths[w],
              B: b.months[w],
              m: q(w + 1),
              o: w + 1,
              y: e.toString().substr(2, 2),
              Y: e,
              H: q(p),
              k: p,
              I: q(p % 12 || 12),
              l: p % 12 || 12,
              M: q(this.get('Minutes', f)),
              p: 12 > p ? 'AM' : 'PM',
              P: 12 > p ? 'am' : 'pm',
              S: q(f.getSeconds()),
              L: q(Math.floor(g % 1e3), 3),
            },
            a.dateFormats,
          );
          u(f, function (b, c) {
            for (; -1 !== d.indexOf('%' + c); )
              d = d.replace(
                '%' + c,
                'function' === typeof b ? b.call(k, g) : b,
              );
          });
          return h ? d.substr(0, 1).toUpperCase() + d.substr(1) : d;
        }
        resolveDTLFormat(d) {
          return D(d, !0)
            ? d
            : ((d = m(d)), { main: d[0], from: d[1], to: d[2] });
        }
        getTimeTicks(d, g, h, q) {
          const f = this,
            p = [],
            t = {};
          var n = new f.Date(g);
          const w = d.unitRange,
            e = d.count || 1;
          let b;
          q = r(q, 1);
          if (H(g)) {
            f.set(
              'Milliseconds',
              n,
              w >= v.second ? 0 : e * Math.floor(f.get('Milliseconds', n) / e),
            );
            w >= v.second &&
              f.set(
                'Seconds',
                n,
                w >= v.minute ? 0 : e * Math.floor(f.get('Seconds', n) / e),
              );
            w >= v.minute &&
              f.set(
                'Minutes',
                n,
                w >= v.hour ? 0 : e * Math.floor(f.get('Minutes', n) / e),
              );
            w >= v.hour &&
              f.set(
                'Hours',
                n,
                w >= v.day ? 0 : e * Math.floor(f.get('Hours', n) / e),
              );
            w >= v.day &&
              f.set(
                'Date',
                n,
                w >= v.month
                  ? 1
                  : Math.max(1, e * Math.floor(f.get('Date', n) / e)),
              );
            if (w >= v.month) {
              f.set(
                'Month',
                n,
                w >= v.year ? 0 : e * Math.floor(f.get('Month', n) / e),
              );
              var c = f.get('FullYear', n);
            }
            w >= v.year && f.set('FullYear', n, c - (c % e));
            w === v.week &&
              ((c = f.get('Day', n)),
              f.set('Date', n, f.get('Date', n) - c + q + (c < q ? -7 : 0)));
            c = f.get('FullYear', n);
            q = f.get('Month', n);
            const l = f.get('Date', n),
              d = f.get('Hours', n);
            g = n.getTime();
            (!f.variableTimezone && f.useUTC) ||
              !H(h) ||
              (b =
                h - g > 4 * v.month ||
                f.getTimezoneOffset(g) !== f.getTimezoneOffset(h));
            g = n.getTime();
            for (n = 1; g < h; )
              (p.push(g),
                (g =
                  w === v.year
                    ? f.makeTime(c + n * e, 0)
                    : w === v.month
                      ? f.makeTime(c, q + n * e)
                      : !b || (w !== v.day && w !== v.week)
                        ? b && w === v.hour && 1 < e
                          ? f.makeTime(c, q, l, d + n * e)
                          : g + w * e
                        : f.makeTime(c, q, l + n * e * (w === v.day ? 1 : 7))),
                n++);
            p.push(g);
            w <= v.hour &&
              1e4 > p.length &&
              p.forEach(function (b) {
                0 === b % 18e5 &&
                  '000000000' === f.dateFormat('%H%M%S%L', b) &&
                  (t[b] = 'day');
              });
          }
          p.info = z(d, { higherRanks: t, totalRange: w * e });
          return p;
        }
        getDateFormat(d, g, h, q) {
          const f = this.dateFormat('%m-%d %H:%M:%S.%L', g),
            p = { millisecond: 15, second: 12, minute: 9, hour: 6, day: 3 };
          let t,
            n = 'millisecond';
          for (t in v) {
            if (
              d === v.week &&
              +this.dateFormat('%w', g) === h &&
              '00:00:00.000' === f.substr(6)
            ) {
              t = 'week';
              break;
            }
            if (v[t] > d) {
              t = n;
              break;
            }
            if (p[t] && f.substr(p[t]) !== '01-01 00:00:00.000'.substr(p[t]))
              break;
            'week' !== t && (n = t);
          }
          return this.resolveDTLFormat(q[t]).main;
        }
      }
      ('');
      return d;
    },
  );
  M(
    a,
    'Core/Defaults.js',
    [
      a['Core/Chart/ChartDefaults.js'],
      a['Core/Color/Color.js'],
      a['Core/Globals.js'],
      a['Core/Color/Palettes.js'],
      a['Core/Time.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z) {
      const { isTouchDevice: x, svg: B } = G,
        { merge: u } = z,
        q = {
          colors: H.colors,
          symbols: ['circle', 'diamond', 'square', 'triangle', 'triangle-down'],
          lang: {
            loading: 'Loading...',
            months:
              'January February March April May June July August September October November December'.split(
                ' ',
              ),
            shortMonths:
              'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '),
            weekdays:
              'Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(
                ' ',
              ),
            decimalPoint: '.',
            numericSymbols: 'kMGTPE'.split(''),
            resetZoom: 'Reset zoom',
            resetZoomTitle: 'Reset zoom level 1:1',
            thousandsSep: ' ',
          },
          global: {},
          time: {
            Date: void 0,
            getTimezoneOffset: void 0,
            timezone: void 0,
            timezoneOffset: 0,
            useUTC: !0,
          },
          chart: a,
          title: {
            style: { color: '#333333', fontWeight: 'bold' },
            text: 'Chart title',
            align: 'center',
            margin: 15,
            widthAdjust: -44,
          },
          subtitle: {
            style: { color: '#666666', fontSize: '0.8em' },
            text: '',
            align: 'center',
            widthAdjust: -44,
          },
          caption: {
            margin: 15,
            style: { color: '#666666', fontSize: '0.8em' },
            text: '',
            align: 'left',
            verticalAlign: 'bottom',
          },
          plotOptions: {},
          legend: {
            enabled: !0,
            align: 'center',
            alignColumns: !0,
            className: 'highcharts-no-tooltip',
            layout: 'horizontal',
            itemMarginBottom: 2,
            itemMarginTop: 2,
            labelFormatter: function () {
              return this.name;
            },
            borderColor: '#999999',
            borderRadius: 0,
            navigation: {
              style: { fontSize: '0.8em' },
              activeColor: '#0022ff',
              inactiveColor: '#cccccc',
            },
            itemStyle: {
              color: '#333333',
              cursor: 'pointer',
              fontSize: '0.8em',
              textDecoration: 'none',
              textOverflow: 'ellipsis',
            },
            itemHoverStyle: { color: '#000000' },
            itemHiddenStyle: {
              color: '#666666',
              textDecoration: 'line-through',
            },
            shadow: !1,
            itemCheckboxStyle: {
              position: 'absolute',
              width: '13px',
              height: '13px',
            },
            squareSymbol: !0,
            symbolPadding: 5,
            verticalAlign: 'bottom',
            x: 0,
            y: 0,
            title: { style: { fontSize: '0.8em', fontWeight: 'bold' } },
          },
          loading: {
            labelStyle: {
              fontWeight: 'bold',
              position: 'relative',
              top: '45%',
            },
            style: {
              position: 'absolute',
              backgroundColor: '#ffffff',
              opacity: 0.5,
              textAlign: 'center',
            },
          },
          tooltip: {
            enabled: !0,
            animation: B,
            borderRadius: 3,
            dateTimeLabelFormats: {
              millisecond: '%A, %e %b, %H:%M:%S.%L',
              second: '%A, %e %b, %H:%M:%S',
              minute: '%A, %e %b, %H:%M',
              hour: '%A, %e %b, %H:%M',
              day: '%A, %e %b %Y',
              week: 'Week from %A, %e %b %Y',
              month: '%B %Y',
              year: '%Y',
            },
            footerFormat: '',
            headerShape: 'callout',
            hideDelay: 500,
            padding: 8,
            shape: 'callout',
            shared: !1,
            snap: x ? 25 : 10,
            headerFormat:
              '<span style="font-size: 0.8em">{point.key}</span><br/>',
            pointFormat:
              '<span style="color:{point.color}">\u25cf</span> {series.name}: <b>{point.y}</b><br/>',
            backgroundColor: '#ffffff',
            borderWidth: void 0,
            shadow: !0,
            stickOnContact: !1,
            style: { color: '#333333', cursor: 'default', fontSize: '0.8em' },
            useHTML: !1,
          },
          credits: {
            enabled: !0,
            href: 'https://www.highcharts.com?credits',
            position: {
              align: 'right',
              x: -10,
              verticalAlign: 'bottom',
              y: -5,
            },
            style: { cursor: 'pointer', color: '#999999', fontSize: '0.6em' },
            text: 'Highcharts.com',
          },
        };
      q.chart.styledMode = !1;
      ('');
      const r = new C(q.time);
      a = {
        defaultOptions: q,
        defaultTime: r,
        getOptions: function () {
          return q;
        },
        setOptions: function (m) {
          u(!0, q, m);
          if (m.time || m.global)
            G.time
              ? G.time.update(u(q.global, q.time, m.global, m.time))
              : (G.time = r);
          return q;
        },
      };
      ('');
      return a;
    },
  );
  M(
    a,
    'Core/Animation/Fx.js',
    [a['Core/Color/Color.js'], a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      const { parse: x } = a,
        { win: C } = A,
        { isNumber: z, objectEach: D } = G;
      class B {
        constructor(a, q, r) {
          this.pos = NaN;
          this.options = q;
          this.elem = a;
          this.prop = r;
        }
        dSetter() {
          var a = this.paths;
          const q = a && a[0];
          a = a && a[1];
          const r = this.now || 0;
          let m = [];
          if (1 !== r && q && a)
            if (q.length === a.length && 1 > r)
              for (let v = 0; v < a.length; v++) {
                const h = q[v],
                  g = a[v],
                  d = [];
                for (let k = 0; k < g.length; k++) {
                  const y = h[k],
                    q = g[k];
                  z(y) && z(q) && ('A' !== g[0] || (4 !== k && 5 !== k))
                    ? (d[k] = y + r * (q - y))
                    : (d[k] = q);
                }
                m.push(d);
              }
            else m = a;
          else m = this.toD || [];
          this.elem.attr('d', m, void 0, !0);
        }
        update() {
          const a = this.elem,
            q = this.prop,
            r = this.now,
            m = this.options.step;
          if (this[q + 'Setter']) this[q + 'Setter']();
          else
            a.attr
              ? a.element && a.attr(q, r, null, !0)
              : (a.style[q] = r + this.unit);
          m && m.call(a, r, this);
        }
        run(a, q, r) {
          const m = this,
            v = m.options,
            h = function (d) {
              return h.stopped ? !1 : m.step(d);
            },
            g =
              C.requestAnimationFrame ||
              function (d) {
                setTimeout(d, 13);
              },
            d = function () {
              for (let d = 0; d < B.timers.length; d++)
                B.timers[d]() || B.timers.splice(d--, 1);
              B.timers.length && g(d);
            };
          a !== q || this.elem['forceAnimate:' + this.prop]
            ? ((this.startTime = +new Date()),
              (this.start = a),
              (this.end = q),
              (this.unit = r),
              (this.now = this.start),
              (this.pos = 0),
              (h.elem = this.elem),
              (h.prop = this.prop),
              h() && 1 === B.timers.push(h) && g(d))
            : (delete v.curAnim[this.prop],
              v.complete &&
                0 === Object.keys(v.curAnim).length &&
                v.complete.call(this.elem));
        }
        step(a) {
          const q = +new Date(),
            r = this.options,
            m = this.elem,
            v = r.complete,
            h = r.duration,
            g = r.curAnim;
          let d;
          m.attr && !m.element
            ? (a = !1)
            : a || q >= h + this.startTime
              ? ((this.now = this.end),
                (this.pos = 1),
                this.update(),
                (d = g[this.prop] = !0),
                D(g, function (k) {
                  !0 !== k && (d = !1);
                }),
                d && v && v.call(m),
                (a = !1))
              : ((this.pos = r.easing((q - this.startTime) / h)),
                (this.now = this.start + (this.end - this.start) * this.pos),
                this.update(),
                (a = !0));
          return a;
        }
        initPath(a, q, r) {
          function m(f, p) {
            for (; f.length < K; ) {
              var t = f[0];
              const n = p[K - f.length];
              n &&
                'M' === t[0] &&
                (f[0] =
                  'C' === n[0]
                    ? ['C', t[1], t[2], t[1], t[2], t[1], t[2]]
                    : ['L', t[1], t[2]]);
              f.unshift(t);
              d && ((t = f.pop()), f.push(f[f.length - 1], t));
            }
          }
          function v(f, p) {
            for (; f.length < K; )
              if (
                ((p = f[Math.floor(f.length / k) - 1].slice()),
                'C' === p[0] && ((p[1] = p[5]), (p[2] = p[6])),
                d)
              ) {
                const d = f[Math.floor(f.length / k)].slice();
                f.splice(f.length / 2, 0, p, d);
              } else f.push(p);
          }
          const h = a.startX,
            g = a.endX;
          r = r.slice();
          const d = a.isArea,
            k = d ? 2 : 1;
          let y, K, L;
          q = q && q.slice();
          if (!q) return [r, r];
          if (h && g && g.length) {
            for (a = 0; a < h.length; a++)
              if (h[a] === g[0]) {
                y = a;
                break;
              } else if (h[0] === g[g.length - h.length + a]) {
                y = a;
                L = !0;
                break;
              } else if (h[h.length - 1] === g[g.length - h.length + a]) {
                y = h.length - a;
                break;
              }
            'undefined' === typeof y && (q = []);
          }
          q.length &&
            z(y) &&
            ((K = r.length + y * k),
            L ? (m(q, r), v(r, q)) : (m(r, q), v(q, r)));
          return [q, r];
        }
        fillSetter() {
          B.prototype.strokeSetter.apply(this, arguments);
        }
        strokeSetter() {
          this.elem.attr(
            this.prop,
            x(this.start).tweenTo(x(this.end), this.pos),
            void 0,
            !0,
          );
        }
      }
      B.timers = [];
      return B;
    },
  );
  M(
    a,
    'Core/Animation/AnimationUtilities.js',
    [a['Core/Animation/Fx.js'], a['Core/Utilities.js']],
    function (a, A) {
      function x(a) {
        return u(a)
          ? q({ duration: 500, defer: 0 }, a)
          : { duration: a ? 500 : 0, defer: 0 };
      }
      function H(q, h) {
        let g = a.timers.length;
        for (; g--; )
          a.timers[g].elem !== q ||
            (h && h !== a.timers[g].prop) ||
            (a.timers[g].stopped = !0);
      }
      const {
        defined: C,
        getStyle: z,
        isArray: D,
        isNumber: B,
        isObject: u,
        merge: q,
        objectEach: r,
        pick: m,
      } = A;
      return {
        animate: function (m, h, g) {
          let d,
            k = '',
            y,
            v,
            L;
          u(g) ||
            ((L = arguments),
            (g = { duration: L[2], easing: L[3], complete: L[4] }));
          B(g.duration) || (g.duration = 400);
          g.easing =
            'function' === typeof g.easing
              ? g.easing
              : Math[g.easing] || Math.easeInOutSine;
          g.curAnim = q(h);
          r(h, function (f, p) {
            H(m, p);
            v = new a(m, g, p);
            y = void 0;
            'd' === p && D(h.d)
              ? ((v.paths = v.initPath(m, m.pathArray, h.d)),
                (v.toD = h.d),
                (d = 0),
                (y = 1))
              : m.attr
                ? (d = m.attr(p))
                : ((d = parseFloat(z(m, p)) || 0),
                  'opacity' !== p && (k = 'px'));
            y || (y = f);
            'string' === typeof y &&
              y.match('px') &&
              (y = y.replace(/px/g, ''));
            v.run(d, y, k);
          });
        },
        animObject: x,
        getDeferredAnimation: function (q, h, g) {
          const d = x(h);
          let k = 0,
            y = 0;
          (g ? [g] : q.series).forEach((g) => {
            g = x(g.options.animation);
            k = h && C(h.defer) ? d.defer : Math.max(k, g.duration + g.defer);
            y = Math.min(d.duration, g.duration);
          });
          q.renderer.forExport && (k = 0);
          return { defer: Math.max(0, k - y), duration: Math.min(k, y) };
        },
        setAnimation: function (q, h) {
          h.renderer.globalAnimation = m(q, h.options.chart.animation, !0);
        },
        stop: H,
      };
    },
  );
  M(
    a,
    'Core/Renderer/HTML/AST.js',
    [a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A) {
      const { SVG_NS: x, win: H } = a,
        {
          attr: C,
          createElement: z,
          css: D,
          error: B,
          isFunction: u,
          isString: q,
          objectEach: r,
          splat: m,
        } = A;
      ({ trustedTypes: A } = H);
      const v =
        A &&
        u(A.createPolicy) &&
        A.createPolicy('highcharts', { createHTML: (d) => d });
      A = v ? v.createHTML('') : '';
      try {
        var h = !!new DOMParser().parseFromString(A, 'text/html');
      } catch (k) {
        h = !1;
      }
      const g = h;
      class d {
        static filterUserAttributes(k) {
          r(k, (g, h) => {
            let y = !0;
            -1 === d.allowedAttributes.indexOf(h) && (y = !1);
            -1 !==
              ['background', 'dynsrc', 'href', 'lowsrc', 'src'].indexOf(h) &&
              (y = q(g) && d.allowedReferences.some((f) => 0 === g.indexOf(f)));
            y ||
              (B(33, !1, void 0, { 'Invalid attribute in config': `${h}` }),
              delete k[h]);
            q(g) && k[h] && (k[h] = g.replace(/</g, '&lt;'));
          });
          return k;
        }
        static parseStyle(d) {
          return d.split(';').reduce((d, k) => {
            k = k.split(':').map((f) => f.trim());
            const g = k.shift();
            g &&
              k.length &&
              (d[g.replace(/-([a-z])/g, (f) => f[1].toUpperCase())] =
                k.join(':'));
            return d;
          }, {});
        }
        static setElementHTML(k, g) {
          k.innerHTML = d.emptyHTML;
          g && new d(g).addToDOM(k);
        }
        constructor(d) {
          this.nodes = 'string' === typeof d ? this.parseMarkup(d) : d;
        }
        addToDOM(k) {
          function g(k, h) {
            let f;
            m(k).forEach(function (p) {
              var t = p.tagName;
              const n = p.textContent
                  ? a.doc.createTextNode(p.textContent)
                  : void 0,
                w = d.bypassHTMLFiltering;
              let e;
              if (t)
                if ('#text' === t) e = n;
                else if (-1 !== d.allowedTags.indexOf(t) || w) {
                  t = a.doc.createElementNS(
                    'svg' === t ? x : h.namespaceURI || x,
                    t,
                  );
                  const b = p.attributes || {};
                  r(p, function (c, e) {
                    'tagName' !== e &&
                      'attributes' !== e &&
                      'children' !== e &&
                      'style' !== e &&
                      'textContent' !== e &&
                      (b[e] = c);
                  });
                  C(t, w ? b : d.filterUserAttributes(b));
                  p.style && D(t, p.style);
                  n && t.appendChild(n);
                  g(p.children || [], t);
                  e = t;
                } else B(33, !1, void 0, { 'Invalid tagName in config': t });
              e && h.appendChild(e);
              f = e;
            });
            return f;
          }
          return g(this.nodes, k);
        }
        parseMarkup(k) {
          const h = [];
          k = k.trim().replace(/ style=(["'])/g, ' data-style=$1');
          if (g)
            k = new DOMParser().parseFromString(
              v ? v.createHTML(k) : k,
              'text/html',
            );
          else {
            const d = z('div');
            d.innerHTML = k;
            k = { body: d };
          }
          const q = (k, f) => {
            var p = k.nodeName.toLowerCase();
            const t = { tagName: p };
            '#text' === p && (t.textContent = k.textContent || '');
            if ((p = k.attributes)) {
              const f = {};
              [].forEach.call(p, (n) => {
                'data-style' === n.name
                  ? (t.style = d.parseStyle(n.value))
                  : (f[n.name] = n.value);
              });
              t.attributes = f;
            }
            if (k.childNodes.length) {
              const f = [];
              [].forEach.call(k.childNodes, (n) => {
                q(n, f);
              });
              f.length && (t.children = f);
            }
            f.push(t);
          };
          [].forEach.call(k.body.childNodes, (d) => q(d, h));
          return h;
        }
      }
      d.allowedAttributes =
        'alt aria-controls aria-describedby aria-expanded aria-haspopup aria-hidden aria-label aria-labelledby aria-live aria-pressed aria-readonly aria-roledescription aria-selected class clip-path color colspan cx cy d dx dy disabled fill flood-color flood-opacity height href id in markerHeight markerWidth offset opacity orient padding paddingLeft paddingRight patternUnits r refX refY role scope slope src startOffset stdDeviation stroke stroke-linecap stroke-width style tableValues result rowspan summary target tabindex text-align text-anchor textAnchor textLength title type valign width x x1 x2 xlink:href y y1 y2 zIndex'.split(
          ' ',
        );
      d.allowedReferences = 'https:// http:// mailto: / ../ ./ #'.split(' ');
      d.allowedTags =
        'a abbr b br button caption circle clipPath code dd defs div dl dt em feComponentTransfer feDropShadow feFuncA feFuncB feFuncG feFuncR feGaussianBlur feOffset feMerge feMergeNode filter h1 h2 h3 h4 h5 h6 hr i img li linearGradient marker ol p path pattern pre rect small span stop strong style sub sup svg table text textPath thead title tbody tspan td th tr u ul #text'.split(
          ' ',
        );
      d.emptyHTML = A;
      d.bypassHTMLFiltering = !1;
      ('');
      return d;
    },
  );
  M(
    a,
    'Core/Templating.js',
    [a['Core/Defaults.js'], a['Core/Utilities.js']],
    function (a, A) {
      function x(g = '', d, k) {
        const y = /\{([a-zA-Z0-9:\.,;\-\/<>%_@"'= #\(\)]+)\}/g,
          q = /\(([a-zA-Z0-9:\.,;\-\/<>%_@"'= ]+)\)/g,
          a = [],
          f = /f$/,
          p = /\.([0-9])/,
          t = C.lang,
          n = (k && k.time) || z,
          w = (k && k.numberFormatter) || H,
          e = (b = '') => {
            let c;
            return 'true' === b
              ? !0
              : 'false' === b
                ? !1
                : (c = Number(b)).toString() === b
                  ? c
                  : B(b, d);
          };
        let b,
          c,
          l = 0,
          I;
        for (; null !== (b = y.exec(g)); ) {
          const e = q.exec(b[1]);
          e && ((b = e), (I = !0));
          (c && c.isBlock) ||
            (c = {
              ctx: d,
              expression: b[1],
              find: b[0],
              isBlock: '#' === b[1].charAt(0),
              start: b.index,
              startInner: b.index + b[0].length,
              length: b[0].length,
            });
          var F = b[1].split(' ')[0].replace('#', '');
          h[F] && (c.isBlock && F === c.fn && l++, c.fn || (c.fn = F));
          F = 'else' === b[1];
          if (c.isBlock && c.fn && (b[1] === `/${c.fn}` || F))
            if (l) F || l--;
            else {
              var J = c.startInner;
              J = g.substr(J, b.index - J);
              void 0 === c.body
                ? ((c.body = J), (c.startInner = b.index + b[0].length))
                : (c.elseBody = J);
              c.find += J + b[0];
              F || (a.push(c), (c = void 0));
            }
          else c.isBlock || a.push(c);
          if (e && (null === c || void 0 === c || !c.isBlock)) break;
        }
        a.forEach((b) => {
          const { body: c, elseBody: l, expression: J, fn: k } = b;
          var E;
          if (k) {
            var F = [b],
              I = J.split(' ');
            for (E = h[k].length; E--; ) F.unshift(e(I[E + 1]));
            E = h[k].apply(d, F);
            b.isBlock && 'boolean' === typeof E && (E = x(E ? c : l, d));
          } else
            ((F = J.split(':')),
              (E = e(F.shift() || '')),
              F.length &&
                'number' === typeof E &&
                ((F = F.join(':')),
                f.test(F)
                  ? ((I = parseInt((F.match(p) || ['', '-1'])[1], 10)),
                    null !== E &&
                      (E = w(
                        E,
                        I,
                        t.decimalPoint,
                        -1 < F.indexOf(',') ? t.thousandsSep : '',
                      )))
                  : (E = n.dateFormat(F, E))));
          g = g.replace(b.find, m(E, ''));
        });
        return I ? x(g, d, k) : g;
      }
      function H(g, d, k, h) {
        g = +g || 0;
        d = +d;
        const y = C.lang;
        var a = (g.toString().split('.')[1] || '').split('e')[0].length;
        const f = g.toString().split('e'),
          p = d;
        if (-1 === d) d = Math.min(a, 20);
        else if (!q(d)) d = 2;
        else if (d && f[1] && 0 > f[1]) {
          var t = d + +f[1];
          0 <= t
            ? ((f[0] = (+f[0]).toExponential(t).split('e')[0]), (d = t))
            : ((f[0] = f[0].split('.')[0] || 0),
              (g = 20 > d ? (f[0] * Math.pow(10, f[1])).toFixed(d) : 0),
              (f[1] = 0));
        }
        t = (
          Math.abs(f[1] ? f[0] : g) + Math.pow(10, -Math.max(d, a) - 1)
        ).toFixed(d);
        a = String(v(t));
        const n = 3 < a.length ? a.length % 3 : 0;
        k = m(k, y.decimalPoint);
        h = m(h, y.thousandsSep);
        g = (0 > g ? '-' : '') + (n ? a.substr(0, n) + h : '');
        g =
          0 > +f[1] && !p
            ? '0'
            : g + a.substr(n).replace(/(\d{3})(?=\d)/g, '$1' + h);
        d && (g += k + t.slice(-d));
        f[1] && 0 !== +g && (g += 'e' + f[1]);
        return g;
      }
      const { defaultOptions: C, defaultTime: z } = a,
        {
          extend: D,
          getNestedProperty: B,
          isArray: u,
          isNumber: q,
          isObject: r,
          pick: m,
          pInt: v,
        } = A,
        h = {
          add: (g, d) => g + d,
          divide: (g, d) => (0 !== d ? g / d : ''),
          eq: (g, d) => g == d,
          each: function (g) {
            const d = arguments[arguments.length - 1];
            return u(g)
              ? g
                  .map((k, h) =>
                    x(
                      d.body,
                      D(r(k) ? k : { '@this': k }, {
                        '@index': h,
                        '@first': 0 === h,
                        '@last': h === g.length - 1,
                      }),
                    ),
                  )
                  .join('')
              : !1;
          },
          ge: (g, d) => g >= d,
          gt: (g, d) => g > d,
          if: (g) => !!g,
          le: (g, d) => g <= d,
          lt: (g, d) => g < d,
          multiply: (g, d) => g * d,
          ne: (g, d) => g != d,
          subtract: (g, d) => g - d,
          unless: (g) => !g,
        };
      return {
        dateFormat: function (g, d, k) {
          return z.dateFormat(g, d, k);
        },
        format: x,
        helpers: h,
        numberFormat: H,
      };
    },
  );
  M(
    a,
    'Core/Renderer/RendererUtilities.js',
    [a['Core/Utilities.js']],
    function (a) {
      const { clamp: x, pick: G, stableSort: H } = a;
      var C;
      (function (a) {
        function D(a, u, q) {
          const r = a;
          var m = r.reducedLen || u,
            v = (d, k) => (k.rank || 0) - (d.rank || 0);
          const h = (d, k) => d.target - k.target;
          let g,
            d = !0,
            k = [],
            y = 0;
          for (g = a.length; g--; ) y += a[g].size;
          if (y > m) {
            H(a, v);
            for (y = g = 0; y <= m; ) ((y += a[g].size), g++);
            k = a.splice(g - 1, a.length);
          }
          H(a, h);
          for (
            a = a.map((d) => ({
              size: d.size,
              targets: [d.target],
              align: G(d.align, 0.5),
            }));
            d;
          ) {
            for (g = a.length; g--; )
              ((m = a[g]),
                (v =
                  (Math.min.apply(0, m.targets) +
                    Math.max.apply(0, m.targets)) /
                  2),
                (m.pos = x(v - m.size * m.align, 0, u - m.size)));
            g = a.length;
            for (d = !1; g--; )
              0 < g &&
                a[g - 1].pos + a[g - 1].size > a[g].pos &&
                ((a[g - 1].size += a[g].size),
                (a[g - 1].targets = a[g - 1].targets.concat(a[g].targets)),
                (a[g - 1].align = 0.5),
                a[g - 1].pos + a[g - 1].size > u &&
                  (a[g - 1].pos = u - a[g - 1].size),
                a.splice(g, 1),
                (d = !0));
          }
          r.push.apply(r, k);
          g = 0;
          a.some((d) => {
            let k = 0;
            return (d.targets || []).some(() => {
              r[g].pos = d.pos + k;
              if (
                'undefined' !== typeof q &&
                Math.abs(r[g].pos - r[g].target) > q
              )
                return (
                  r.slice(0, g + 1).forEach((f) => delete f.pos),
                  (r.reducedLen = (r.reducedLen || u) - 0.1 * u),
                  r.reducedLen > 0.1 * u && D(r, u, q),
                  !0
                );
              k += r[g].size;
              g++;
              return !1;
            });
          });
          H(r, h);
          return r;
        }
        a.distribute = D;
      })(C || (C = {}));
      return C;
    },
  );
  M(
    a,
    'Core/Renderer/SVG/SVGElement.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Color/Color.js'],
      a['Core/Globals.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H) {
      const { animate: x, animObject: z, stop: D } = a,
        { deg2rad: B, doc: u, svg: q, SVG_NS: r, win: m } = G,
        {
          addEvent: v,
          attr: h,
          createElement: g,
          css: d,
          defined: k,
          erase: y,
          extend: K,
          fireEvent: L,
          isArray: f,
          isFunction: p,
          isObject: t,
          isString: n,
          merge: w,
          objectEach: e,
          pick: b,
          pInt: c,
          syncTimeout: l,
          uniqueKey: I,
        } = H;
      class F {
        constructor() {
          this.element = void 0;
          this.onEvents = {};
          this.opacity = 1;
          this.renderer = void 0;
          this.SVG_NS = r;
        }
        _defaultGetter(c) {
          c = b(
            this[c + 'Value'],
            this[c],
            this.element ? this.element.getAttribute(c) : null,
            0,
          );
          /^[\-0-9\.]+$/.test(c) && (c = parseFloat(c));
          return c;
        }
        _defaultSetter(b, c, e) {
          e.setAttribute(c, b);
        }
        add(b) {
          const c = this.renderer,
            e = this.element;
          let l;
          b && (this.parentGroup = b);
          'undefined' !== typeof this.textStr &&
            'text' === this.element.nodeName &&
            c.buildText(this);
          this.added = !0;
          if (!b || b.handleZ || this.zIndex) l = this.zIndexSetter();
          l || (b ? b.element : c.box).appendChild(e);
          if (this.onAdd) this.onAdd();
          return this;
        }
        addClass(b, c) {
          const e = c ? '' : this.attr('class') || '';
          b = (b || '')
            .split(/ /g)
            .reduce(
              function (b, c) {
                -1 === e.indexOf(c) && b.push(c);
                return b;
              },
              e ? [e] : [],
            )
            .join(' ');
          b !== e && this.attr('class', b);
          return this;
        }
        afterSetters() {
          this.doTransform && (this.updateTransform(), (this.doTransform = !1));
        }
        align(c, e, l) {
          const f = {};
          var p = this.renderer,
            d = p.alignedObjects,
            E;
          let J, t;
          if (c) {
            if (
              ((this.alignOptions = c), (this.alignByTranslate = e), !l || n(l))
            )
              ((this.alignTo = E = l || 'renderer'),
                y(d, this),
                d.push(this),
                (l = void 0));
          } else
            ((c = this.alignOptions),
              (e = this.alignByTranslate),
              (E = this.alignTo));
          l = b(l, p[E], 'scrollablePlotBox' === E ? p.plotBox : void 0, p);
          E = c.align;
          const w = c.verticalAlign;
          p = (l.x || 0) + (c.x || 0);
          d = (l.y || 0) + (c.y || 0);
          'right' === E ? (J = 1) : 'center' === E && (J = 2);
          J && (p += (l.width - (c.width || 0)) / J);
          f[e ? 'translateX' : 'x'] = Math.round(p);
          'bottom' === w ? (t = 1) : 'middle' === w && (t = 2);
          t && (d += (l.height - (c.height || 0)) / t);
          f[e ? 'translateY' : 'y'] = Math.round(d);
          this[this.placed ? 'animate' : 'attr'](f);
          this.placed = !0;
          this.alignAttr = f;
          return this;
        }
        alignSetter(b) {
          const c = { left: 'start', center: 'middle', right: 'end' };
          c[b] &&
            ((this.alignValue = b),
            this.element.setAttribute('text-anchor', c[b]));
        }
        animate(c, f, n) {
          const p = z(b(f, this.renderer.globalAnimation, !0));
          f = p.defer;
          u.hidden && (p.duration = 0);
          0 !== p.duration
            ? (n && (p.complete = n),
              l(() => {
                this.element && x(this, c, p);
              }, f))
            : (this.attr(c, void 0, n || p.complete),
              e(
                c,
                function (b, c) {
                  p.step &&
                    p.step.call(this, b, { prop: c, pos: 1, elem: this });
                },
                this,
              ));
          return this;
        }
        applyTextOutline(b) {
          const c = this.element;
          -1 !== b.indexOf('contrast') &&
            (b = b.replace(
              /contrast/g,
              this.renderer.getContrast(c.style.fill),
            ));
          var e = b.split(' ');
          b = e[e.length - 1];
          if ((e = e[0]) && 'none' !== e && G.svg) {
            this.fakeTS = !0;
            e = e.replace(/(^[\d\.]+)(.*?)$/g, function (b, c, e) {
              return 2 * Number(c) + e;
            });
            this.removeTextOutline();
            const l = u.createElementNS(r, 'tspan');
            h(l, {
              class: 'highcharts-text-outline',
              fill: b,
              stroke: b,
              'stroke-width': e,
              'stroke-linejoin': 'round',
            });
            b = c.querySelector('textPath') || c;
            [].forEach.call(b.childNodes, (b) => {
              const c = b.cloneNode(!0);
              c.removeAttribute &&
                ['fill', 'stroke', 'stroke-width', 'stroke'].forEach((b) =>
                  c.removeAttribute(b),
                );
              l.appendChild(c);
            });
            let f = 0;
            [].forEach.call(b.querySelectorAll('text tspan'), (b) => {
              f += Number(b.getAttribute('dy'));
            });
            e = u.createElementNS(r, 'tspan');
            e.textContent = '\u200b';
            h(e, { x: Number(c.getAttribute('x')), dy: -f });
            l.appendChild(e);
            b.insertBefore(l, b.firstChild);
          }
        }
        attr(b, c, l, f) {
          const n = this.element,
            p = F.symbolCustomAttribs;
          let E,
            d,
            t = this,
            J,
            w;
          'string' === typeof b &&
            'undefined' !== typeof c &&
            ((E = b), (b = {}), (b[E] = c));
          'string' === typeof b
            ? (t = (this[b + 'Getter'] || this._defaultGetter).call(this, b, n))
            : (e(
                b,
                function (c, e) {
                  J = !1;
                  f || D(this, e);
                  this.symbolName &&
                    -1 !== p.indexOf(e) &&
                    (d || (this.symbolAttr(b), (d = !0)), (J = !0));
                  !this.rotation ||
                    ('x' !== e && 'y' !== e) ||
                    (this.doTransform = !0);
                  J ||
                    ((w = this[e + 'Setter'] || this._defaultSetter),
                    w.call(this, c, e, n));
                },
                this,
              ),
              this.afterSetters());
          l && l.call(this);
          return t;
        }
        clip(b) {
          return this.attr(
            'clip-path',
            b ? 'url(' + this.renderer.url + '#' + b.id + ')' : 'none',
          );
        }
        crisp(b, c) {
          c = c || b.strokeWidth || 0;
          const e = (Math.round(c) % 2) / 2;
          b.x = Math.floor(b.x || this.x || 0) + e;
          b.y = Math.floor(b.y || this.y || 0) + e;
          b.width = Math.floor((b.width || this.width || 0) - 2 * e);
          b.height = Math.floor((b.height || this.height || 0) - 2 * e);
          k(b.strokeWidth) && (b.strokeWidth = c);
          return b;
        }
        complexColor(b, c, l) {
          const n = this.renderer;
          let p,
            d,
            E,
            t,
            J,
            g,
            F,
            N,
            h,
            a,
            y = [],
            q;
          L(this.renderer, 'complexColor', { args: arguments }, function () {
            b.radialGradient
              ? (d = 'radialGradient')
              : b.linearGradient && (d = 'linearGradient');
            if (d) {
              E = b[d];
              J = n.gradients;
              g = b.stops;
              h = l.radialReference;
              f(E) &&
                (b[d] = E =
                  {
                    x1: E[0],
                    y1: E[1],
                    x2: E[2],
                    y2: E[3],
                    gradientUnits: 'userSpaceOnUse',
                  });
              'radialGradient' === d &&
                h &&
                !k(E.gradientUnits) &&
                ((t = E),
                (E = w(E, n.getRadialAttr(h, t), {
                  gradientUnits: 'userSpaceOnUse',
                })));
              e(E, function (b, c) {
                'id' !== c && y.push(c, b);
              });
              e(g, function (b) {
                y.push(b);
              });
              y = y.join(',');
              if (J[y]) a = J[y].attr('id');
              else {
                E.id = a = I();
                const b = (J[y] = n.createElement(d).attr(E).add(n.defs));
                b.radAttr = t;
                b.stops = [];
                g.forEach(function (c) {
                  0 === c[1].indexOf('rgba')
                    ? ((p = A.parse(c[1])),
                      (F = p.get('rgb')),
                      (N = p.get('a')))
                    : ((F = c[1]), (N = 1));
                  c = n
                    .createElement('stop')
                    .attr({ offset: c[0], 'stop-color': F, 'stop-opacity': N })
                    .add(b);
                  b.stops.push(c);
                });
              }
              q = 'url(' + n.url + '#' + a + ')';
              l.setAttribute(c, q);
              l.gradient = y;
              b.toString = function () {
                return q;
              };
            }
          });
        }
        css(b) {
          const l = this.styles,
            f = {},
            n = this.element;
          let p,
            t = !l;
          l &&
            e(b, function (b, c) {
              l && l[c] !== b && ((f[c] = b), (t = !0));
            });
          if (t) {
            l && (b = K(l, f));
            null === b.width || 'auto' === b.width
              ? delete this.textWidth
              : 'text' === n.nodeName.toLowerCase() &&
                b.width &&
                (p = this.textWidth = c(b.width));
            this.styles = b;
            p && !q && this.renderer.forExport && delete b.width;
            const e = w(b);
            n.namespaceURI === this.SVG_NS &&
              (['textOutline', 'textOverflow', 'width'].forEach(
                (b) => e && delete e[b],
              ),
              e.color && (e.fill = e.color));
            d(n, e);
          }
          this.added &&
            ('text' === this.element.nodeName && this.renderer.buildText(this),
            b.textOutline && this.applyTextOutline(b.textOutline));
          return this;
        }
        dashstyleSetter(e) {
          let l = this['stroke-width'];
          'inherit' === l && (l = 1);
          if ((e = e && e.toLowerCase())) {
            const f = e
              .replace('shortdashdotdot', '3,1,1,1,1,1,')
              .replace('shortdashdot', '3,1,1,1')
              .replace('shortdot', '1,1,')
              .replace('shortdash', '3,1,')
              .replace('longdash', '8,3,')
              .replace(/dot/g, '1,3,')
              .replace('dash', '4,3,')
              .replace(/,$/, '')
              .split(',');
            for (e = f.length; e--; ) f[e] = '' + c(f[e]) * b(l, NaN);
            e = f.join(',').replace(/NaN/g, 'none');
            this.element.setAttribute('stroke-dasharray', e);
          }
        }
        destroy() {
          const b = this;
          var c = b.element || {};
          const l = b.renderer;
          var f = c.ownerSVGElement;
          let n = ('SPAN' === c.nodeName && b.parentGroup) || void 0;
          c.onclick =
            c.onmouseout =
            c.onmouseover =
            c.onmousemove =
            c.point =
              null;
          D(b);
          if (b.clipPath && f) {
            const c = b.clipPath;
            [].forEach.call(
              f.querySelectorAll('[clip-path],[CLIP-PATH]'),
              function (b) {
                -1 < b.getAttribute('clip-path').indexOf(c.element.id) &&
                  b.removeAttribute('clip-path');
              },
            );
            b.clipPath = c.destroy();
          }
          if (b.stops) {
            for (f = 0; f < b.stops.length; f++) b.stops[f].destroy();
            b.stops.length = 0;
            b.stops = void 0;
          }
          for (
            b.safeRemoveChild(c);
            n && n.div && 0 === n.div.childNodes.length;
          )
            ((c = n.parentGroup),
              b.safeRemoveChild(n.div),
              delete n.div,
              (n = c));
          b.alignTo && y(l.alignedObjects, b);
          e(b, function (c, e) {
            b[e] && b[e].parentGroup === b && b[e].destroy && b[e].destroy();
            delete b[e];
          });
        }
        dSetter(b, c, e) {
          f(b) &&
            ('string' === typeof b[0] && (b = this.renderer.pathToSegments(b)),
            (this.pathArray = b),
            (b = b.reduce(
              (b, c, e) =>
                c && c.join
                  ? (e ? b + ' ' : '') + c.join(' ')
                  : (c || '').toString(),
              '',
            )));
          /(NaN| {2}|^$)/.test(b) && (b = 'M 0 0');
          this[c] !== b && (e.setAttribute(c, b), (this[c] = b));
        }
        fadeOut(c) {
          const e = this;
          e.animate(
            { opacity: 0 },
            {
              duration: b(c, 150),
              complete: function () {
                e.hide();
              },
            },
          );
        }
        fillSetter(b, c, e) {
          'string' === typeof b
            ? e.setAttribute(c, b)
            : b && this.complexColor(b, c, e);
        }
        getBBox(c, e) {
          const {
              alignValue: l,
              element: f,
              renderer: n,
              styles: t,
              textStr: E,
            } = this,
            { cache: w, cacheKeys: g } = n;
          var J = f.namespaceURI === this.SVG_NS;
          e = b(e, this.rotation, 0);
          var h = n.styledMode
            ? f && F.prototype.getStyle.call(f, 'font-size')
            : t && t.fontSize;
          let N;
          let I;
          k(E) &&
            ((I = E.toString()),
            -1 === I.indexOf('<') && (I = I.replace(/[0-9]/g, '0')),
            (I += [
              '',
              n.rootFontSize,
              h,
              e,
              this.textWidth,
              l,
              t && t.textOverflow,
              t && t.fontWeight,
            ].join()));
          I && !c && (N = w[I]);
          if (!N) {
            if (J || n.forExport) {
              try {
                var a =
                  this.fakeTS &&
                  function (b) {
                    const c = f.querySelector('.highcharts-text-outline');
                    c && d(c, { display: b });
                  };
                p(a) && a('none');
                N = f.getBBox
                  ? K({}, f.getBBox())
                  : {
                      width: f.offsetWidth,
                      height: f.offsetHeight,
                      x: 0,
                      y: 0,
                    };
                p(a) && a('');
              } catch (ea) {
                ('');
              }
              if (!N || 0 > N.width) N = { x: 0, y: 0, width: 0, height: 0 };
            } else N = this.htmlGetBBox();
            a = N.width;
            c = N.height;
            J &&
              (N.height = c =
                { '11px,17': 14, '13px,20': 16 }[
                  `${h || ''},${Math.round(c)}`
                ] || c);
            if (e) {
              J = Number(f.getAttribute('y') || 0) - N.y;
              h = { right: 1, center: 0.5 }[l || 0] || 0;
              var y = e * B,
                q = (e - 90) * B,
                m = a * Math.cos(y);
              e = a * Math.sin(y);
              var r = Math.cos(q);
              y = Math.sin(q);
              a = N.x + h * (a - m) + J * r;
              q = a + m;
              r = q - c * r;
              m = r - m;
              J = N.y + J - h * e + J * y;
              h = J + e;
              c = h - c * y;
              e = c - e;
              N.x = Math.min(a, q, r, m);
              N.y = Math.min(J, h, c, e);
              N.width = Math.max(a, q, r, m) - N.x;
              N.height = Math.max(J, h, c, e) - N.y;
            }
          }
          if (I && ('' === E || 0 < N.height)) {
            for (; 250 < g.length; ) delete w[g.shift()];
            w[I] || g.push(I);
            w[I] = N;
          }
          return N;
        }
        getStyle(b) {
          return m
            .getComputedStyle(this.element || this, '')
            .getPropertyValue(b);
        }
        hasClass(b) {
          return -1 !== ('' + this.attr('class')).split(' ').indexOf(b);
        }
        hide() {
          return this.attr({ visibility: 'hidden' });
        }
        htmlGetBBox() {
          return { height: 0, width: 0, x: 0, y: 0 };
        }
        init(b, c) {
          this.element =
            'span' === c ? g(c) : u.createElementNS(this.SVG_NS, c);
          this.renderer = b;
          L(this, 'afterInit');
        }
        on(b, c) {
          const { onEvents: e } = this;
          if (e[b]) e[b]();
          e[b] = v(this.element, b, c);
          return this;
        }
        opacitySetter(b, c, e) {
          this.opacity = b = Number(Number(b).toFixed(3));
          e.setAttribute(c, b);
        }
        removeClass(b) {
          return this.attr(
            'class',
            ('' + this.attr('class'))
              .replace(n(b) ? new RegExp(`(^| )${b}( |$)`) : b, ' ')
              .replace(/ +/g, ' ')
              .trim(),
          );
        }
        removeTextOutline() {
          const b = this.element.querySelector('tspan.highcharts-text-outline');
          b && this.safeRemoveChild(b);
        }
        safeRemoveChild(b) {
          const c = b.parentNode;
          c && c.removeChild(b);
        }
        setRadialReference(b) {
          const c =
            this.element.gradient &&
            this.renderer.gradients[this.element.gradient];
          this.element.radialReference = b;
          c &&
            c.radAttr &&
            c.animate(this.renderer.getRadialAttr(b, c.radAttr));
          return this;
        }
        setTextPath(b, c) {
          c = w(
            !0,
            {
              enabled: !0,
              attributes: { dy: -5, startOffset: '50%', textAnchor: 'middle' },
            },
            c,
          );
          const e = this.renderer.url,
            l = this.text || this,
            f = l.textPath,
            { attributes: n, enabled: E } = c;
          b = b || (f && f.path);
          f && f.undo();
          b && E
            ? ((c = v(l, 'afterModifyTree', (c) => {
                if (b && E) {
                  let E = b.attr('id');
                  E || b.attr('id', (E = I()));
                  var f = { x: 0, y: 0 };
                  k(n.dx) && ((f.dx = n.dx), delete n.dx);
                  k(n.dy) && ((f.dy = n.dy), delete n.dy);
                  l.attr(f);
                  this.attr({ transform: '' });
                  this.box && (this.box = this.box.destroy());
                  f = c.nodes.slice(0);
                  c.nodes.length = 0;
                  c.nodes[0] = {
                    tagName: 'textPath',
                    attributes: K(n, {
                      'text-anchor': n.textAnchor,
                      href: `${e}#${E}`,
                    }),
                    children: f,
                  };
                }
              })),
              (l.textPath = { path: b, undo: c }))
            : (l.attr({ dx: 0, dy: 0 }), delete l.textPath);
          this.added && ((l.textCache = ''), this.renderer.buildText(l));
          return this;
        }
        shadow(b) {
          var c;
          const { renderer: e } = this,
            l = w(
              90 ===
                (null === (c = this.parentGroup) || void 0 === c
                  ? void 0
                  : c.rotation)
                ? { offsetX: -1, offsetY: -1 }
                : {},
              t(b) ? b : {},
            );
          c = e.shadowDefinition(l);
          return this.attr({ filter: b ? `url(${e.url}#${c})` : 'none' });
        }
        show(b = !0) {
          return this.attr({ visibility: b ? 'inherit' : 'visible' });
        }
        ['stroke-widthSetter'](b, c, e) {
          this[c] = b;
          e.setAttribute(c, b);
        }
        strokeWidth() {
          if (!this.renderer.styledMode) return this['stroke-width'] || 0;
          const b = this.getStyle('stroke-width');
          let e = 0,
            l;
          b.indexOf('px') === b.length - 2
            ? (e = c(b))
            : '' !== b &&
              ((l = u.createElementNS(r, 'rect')),
              h(l, { width: b, 'stroke-width': 0 }),
              this.element.parentNode.appendChild(l),
              (e = l.getBBox().width),
              l.parentNode.removeChild(l));
          return e;
        }
        symbolAttr(c) {
          const e = this;
          F.symbolCustomAttribs.forEach(function (l) {
            e[l] = b(c[l], e[l]);
          });
          e.attr({
            d: e.renderer.symbols[e.symbolName](e.x, e.y, e.width, e.height, e),
          });
        }
        textSetter(b) {
          b !== this.textStr &&
            (delete this.textPxLength,
            (this.textStr = b),
            this.added && this.renderer.buildText(this));
        }
        titleSetter(c) {
          const e = this.element,
            l =
              e.getElementsByTagName('title')[0] ||
              u.createElementNS(this.SVG_NS, 'title');
          e.insertBefore ? e.insertBefore(l, e.firstChild) : e.appendChild(l);
          l.textContent = String(b(c, ''))
            .replace(/<[^>]*>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        }
        toFront() {
          const b = this.element;
          b.parentNode.appendChild(b);
          return this;
        }
        translate(b, c) {
          return this.attr({ translateX: b, translateY: c });
        }
        updateTransform() {
          const {
              element: c,
              matrix: e,
              rotation: l = 0,
              scaleX: f,
              scaleY: n,
              translateX: p = 0,
              translateY: E = 0,
            } = this,
            d = ['translate(' + p + ',' + E + ')'];
          k(e) && d.push('matrix(' + e.join(',') + ')');
          l &&
            d.push(
              'rotate(' +
                l +
                ' ' +
                b(this.rotationOriginX, c.getAttribute('x'), 0) +
                ' ' +
                b(this.rotationOriginY, c.getAttribute('y') || 0) +
                ')',
            );
          (k(f) || k(n)) && d.push('scale(' + b(f, 1) + ' ' + b(n, 1) + ')');
          d.length &&
            !(this.text || this).textPath &&
            c.setAttribute('transform', d.join(' '));
        }
        visibilitySetter(b, c, e) {
          'inherit' === b
            ? e.removeAttribute(c)
            : this[c] !== b && e.setAttribute(c, b);
          this[c] = b;
        }
        xGetter(b) {
          'circle' === this.element.nodeName &&
            ('x' === b ? (b = 'cx') : 'y' === b && (b = 'cy'));
          return this._defaultGetter(b);
        }
        zIndexSetter(b, e) {
          var l = this.renderer,
            f = this.parentGroup;
          const n = (f || l).element || l.box,
            p = this.element;
          l = n === l.box;
          let E = !1,
            d;
          var t = this.added;
          let w;
          k(b)
            ? (p.setAttribute('data-z-index', b),
              (b = +b),
              this[e] === b && (t = !1))
            : k(this[e]) && p.removeAttribute('data-z-index');
          this[e] = b;
          if (t) {
            (b = this.zIndex) && f && (f.handleZ = !0);
            e = n.childNodes;
            for (w = e.length - 1; 0 <= w && !E; w--)
              if (
                ((f = e[w]),
                (t = f.getAttribute('data-z-index')),
                (d = !k(t)),
                f !== p)
              )
                if (0 > b && d && !l && !w) (n.insertBefore(p, e[w]), (E = !0));
                else if (c(t) <= b || (d && (!k(b) || 0 <= b)))
                  (n.insertBefore(p, e[w + 1]), (E = !0));
            E || (n.insertBefore(p, e[l ? 3 : 0]), (E = !0));
          }
          return E;
        }
      }
      F.symbolCustomAttribs =
        'anchorX anchorY clockwise end height innerR r start width x y'.split(
          ' ',
        );
      F.prototype.strokeSetter = F.prototype.fillSetter;
      F.prototype.yGetter = F.prototype.xGetter;
      F.prototype.matrixSetter =
        F.prototype.rotationOriginXSetter =
        F.prototype.rotationOriginYSetter =
        F.prototype.rotationSetter =
        F.prototype.scaleXSetter =
        F.prototype.scaleYSetter =
        F.prototype.translateXSetter =
        F.prototype.translateYSetter =
        F.prototype.verticalAlignSetter =
          function (b, c) {
            this[c] = b;
            this.doTransform = !0;
          };
      ('');
      return F;
    },
  );
  M(
    a,
    'Core/Renderer/RendererRegistry.js',
    [a['Core/Globals.js']],
    function (a) {
      var x;
      (function (x) {
        x.rendererTypes = {};
        let A;
        x.getRendererType = function (a = A) {
          return x.rendererTypes[a] || x.rendererTypes[A];
        };
        x.registerRendererType = function (C, z, D) {
          x.rendererTypes[C] = z;
          if (!A || D) ((A = C), (a.Renderer = z));
        };
      })(x || (x = {}));
      return x;
    },
  );
  M(
    a,
    'Core/Renderer/SVG/SVGLabel.js',
    [a['Core/Renderer/SVG/SVGElement.js'], a['Core/Utilities.js']],
    function (a, A) {
      const {
        defined: x,
        extend: H,
        isNumber: C,
        merge: z,
        pick: D,
        removeEvent: B,
      } = A;
      class u extends a {
        constructor(a, r, m, v, h, g, d, k, y, K) {
          super();
          this.paddingRightSetter = this.paddingLeftSetter = this.paddingSetter;
          this.init(a, 'g');
          this.textStr = r;
          this.x = m;
          this.y = v;
          this.anchorX = g;
          this.anchorY = d;
          this.baseline = y;
          this.className = K;
          this.addClass(
            'button' === K ? 'highcharts-no-tooltip' : 'highcharts-label',
          );
          K && this.addClass('highcharts-' + K);
          this.text = a.text(void 0, 0, 0, k).attr({ zIndex: 1 });
          let q;
          'string' === typeof h &&
            ((q = /^url\((.*?)\)$/.test(h)) || this.renderer.symbols[h]) &&
            (this.symbolKey = h);
          this.bBox = u.emptyBBox;
          this.padding = 3;
          this.baselineOffset = 0;
          this.needsBox = a.styledMode || q;
          this.deferredAttr = {};
          this.alignFactor = 0;
        }
        alignSetter(a) {
          a = { left: 0, center: 0.5, right: 1 }[a];
          a !== this.alignFactor &&
            ((this.alignFactor = a),
            this.bBox && C(this.xSetting) && this.attr({ x: this.xSetting }));
        }
        anchorXSetter(a, r) {
          this.anchorX = a;
          this.boxAttr(
            r,
            Math.round(a) - this.getCrispAdjust() - this.xSetting,
          );
        }
        anchorYSetter(a, r) {
          this.anchorY = a;
          this.boxAttr(r, a - this.ySetting);
        }
        boxAttr(a, r) {
          this.box ? this.box.attr(a, r) : (this.deferredAttr[a] = r);
        }
        css(q) {
          if (q) {
            const a = {};
            q = z(q);
            u.textProps.forEach((m) => {
              'undefined' !== typeof q[m] && ((a[m] = q[m]), delete q[m]);
            });
            this.text.css(a);
            'fontSize' in a || 'fontWeight' in a
              ? this.updateTextPadding()
              : ('width' in a || 'textOverflow' in a) && this.updateBoxSize();
          }
          return a.prototype.css.call(this, q);
        }
        destroy() {
          B(this.element, 'mouseenter');
          B(this.element, 'mouseleave');
          this.text && this.text.destroy();
          this.box && (this.box = this.box.destroy());
          a.prototype.destroy.call(this);
        }
        fillSetter(a, r) {
          a && (this.needsBox = !0);
          this.fill = a;
          this.boxAttr(r, a);
        }
        getBBox() {
          this.textStr &&
            0 === this.bBox.width &&
            0 === this.bBox.height &&
            this.updateBoxSize();
          const a = this.padding,
            r = D(this.paddingLeft, a);
          return {
            width: this.width,
            height: this.height,
            x: this.bBox.x - r,
            y: this.bBox.y - a,
          };
        }
        getCrispAdjust() {
          return this.renderer.styledMode && this.box
            ? (this.box.strokeWidth() % 2) / 2
            : ((this['stroke-width'] ? parseInt(this['stroke-width'], 10) : 0) %
                2) /
                2;
        }
        heightSetter(a) {
          this.heightSetting = a;
        }
        onAdd() {
          this.text.add(this);
          this.attr({
            text: D(this.textStr, ''),
            x: this.x || 0,
            y: this.y || 0,
          });
          this.box &&
            x(this.anchorX) &&
            this.attr({ anchorX: this.anchorX, anchorY: this.anchorY });
        }
        paddingSetter(a, r) {
          C(a)
            ? a !== this[r] && ((this[r] = a), this.updateTextPadding())
            : (this[r] = void 0);
        }
        rSetter(a, r) {
          this.boxAttr(r, a);
        }
        strokeSetter(a, r) {
          this.stroke = a;
          this.boxAttr(r, a);
        }
        ['stroke-widthSetter'](a, r) {
          a && (this.needsBox = !0);
          this['stroke-width'] = a;
          this.boxAttr(r, a);
        }
        ['text-alignSetter'](a) {
          this.textAlign = a;
        }
        textSetter(a) {
          'undefined' !== typeof a && this.text.attr({ text: a });
          this.updateTextPadding();
        }
        updateBoxSize() {
          var a = this.text;
          const r = {},
            m = this.padding,
            v = (this.bBox =
              (C(this.widthSetting) &&
                C(this.heightSetting) &&
                !this.textAlign) ||
              !x(a.textStr)
                ? u.emptyBBox
                : a.getBBox());
          this.width = this.getPaddedWidth();
          this.height = (this.heightSetting || v.height || 0) + 2 * m;
          const h = this.renderer.fontMetrics(a);
          this.baselineOffset =
            m +
            Math.min((this.text.firstLineMetrics || h).b, v.height || Infinity);
          this.heightSetting &&
            (this.baselineOffset += (this.heightSetting - h.h) / 2);
          this.needsBox &&
            !a.textPath &&
            (this.box ||
              ((a = this.box =
                this.symbolKey
                  ? this.renderer.symbol(this.symbolKey)
                  : this.renderer.rect()),
              a.addClass(
                ('button' === this.className ? '' : 'highcharts-label-box') +
                  (this.className
                    ? ' highcharts-' + this.className + '-box'
                    : ''),
              ),
              a.add(this)),
            (a = this.getCrispAdjust()),
            (r.x = a),
            (r.y = (this.baseline ? -this.baselineOffset : 0) + a),
            (r.width = Math.round(this.width)),
            (r.height = Math.round(this.height)),
            this.box.attr(H(r, this.deferredAttr)),
            (this.deferredAttr = {}));
        }
        updateTextPadding() {
          const a = this.text;
          if (!a.textPath) {
            this.updateBoxSize();
            const q = this.baseline ? 0 : this.baselineOffset;
            let m = D(this.paddingLeft, this.padding);
            x(this.widthSetting) &&
              this.bBox &&
              ('center' === this.textAlign || 'right' === this.textAlign) &&
              (m +=
                { center: 0.5, right: 1 }[this.textAlign] *
                (this.widthSetting - this.bBox.width));
            if (m !== a.x || q !== a.y)
              (a.attr('x', m),
                a.hasBoxWidthChanged && (this.bBox = a.getBBox(!0)),
                'undefined' !== typeof q && a.attr('y', q));
            a.x = m;
            a.y = q;
          }
        }
        widthSetter(a) {
          this.widthSetting = C(a) ? a : void 0;
        }
        getPaddedWidth() {
          var a = this.padding;
          const r = D(this.paddingLeft, a);
          a = D(this.paddingRight, a);
          return (this.widthSetting || this.bBox.width || 0) + r + a;
        }
        xSetter(a) {
          this.x = a;
          this.alignFactor &&
            ((a -= this.alignFactor * this.getPaddedWidth()),
            (this['forceAnimate:x'] = !0));
          this.xSetting = Math.round(a);
          this.attr('translateX', this.xSetting);
        }
        ySetter(a) {
          this.ySetting = this.y = Math.round(a);
          this.attr('translateY', this.ySetting);
        }
      }
      u.emptyBBox = { width: 0, height: 0, x: 0, y: 0 };
      u.textProps =
        'color direction fontFamily fontSize fontStyle fontWeight lineHeight textAlign textDecoration textOutline textOverflow whiteSpace width'.split(
          ' ',
        );
      return u;
    },
  );
  M(a, 'Core/Renderer/SVG/Symbols.js', [a['Core/Utilities.js']], function (a) {
    function x(a, u, q, r, m) {
      const v = [];
      if (m) {
        const h = m.start || 0,
          g = D(m.r, q);
        q = D(m.r, r || q);
        r = (m.end || 0) - 0.001;
        const d = m.innerR,
          k = D(m.open, 0.001 > Math.abs((m.end || 0) - h - 2 * Math.PI)),
          y = Math.cos(h),
          K = Math.sin(h),
          L = Math.cos(r),
          f = Math.sin(r),
          p = D(m.longArc, 0.001 > r - h - Math.PI ? 0 : 1);
        let t = ['A', g, q, 0, p, D(m.clockwise, 1), a + g * L, u + q * f];
        t.params = { start: h, end: r, cx: a, cy: u };
        v.push(['M', a + g * y, u + q * K], t);
        C(d) &&
          ((t = [
            'A',
            d,
            d,
            0,
            p,
            C(m.clockwise) ? 1 - m.clockwise : 0,
            a + d * y,
            u + d * K,
          ]),
          (t.params = { start: r, end: h, cx: a, cy: u }),
          v.push(
            k ? ['M', a + d * L, u + d * f] : ['L', a + d * L, u + d * f],
            t,
          ));
        k || v.push(['Z']);
      }
      return v;
    }
    function G(a, u, q, r, m) {
      return m && m.r
        ? H(a, u, q, r, m)
        : [
            ['M', a, u],
            ['L', a + q, u],
            ['L', a + q, u + r],
            ['L', a, u + r],
            ['Z'],
          ];
    }
    function H(a, u, q, r, m) {
      m = (null === m || void 0 === m ? void 0 : m.r) || 0;
      return [
        ['M', a + m, u],
        ['L', a + q - m, u],
        ['A', m, m, 0, 0, 1, a + q, u + m],
        ['L', a + q, u + r - m],
        ['A', m, m, 0, 0, 1, a + q - m, u + r],
        ['L', a + m, u + r],
        ['A', m, m, 0, 0, 1, a, u + r - m],
        ['L', a, u + m],
        ['A', m, m, 0, 0, 1, a + m, u],
        ['Z'],
      ];
    }
    const { defined: C, isNumber: z, pick: D } = a;
    return {
      arc: x,
      callout: function (a, u, q, r, m) {
        const v = Math.min((m && m.r) || 0, q, r),
          h = v + 6,
          g = m && m.anchorX;
        m = (m && m.anchorY) || 0;
        const d = H(a, u, q, r, { r: v });
        if (!z(g)) return d;
        a + g >= q
          ? m > u + h && m < u + r - h
            ? d.splice(
                3,
                1,
                ['L', a + q, m - 6],
                ['L', a + q + 6, m],
                ['L', a + q, m + 6],
                ['L', a + q, u + r - v],
              )
            : d.splice(
                3,
                1,
                ['L', a + q, r / 2],
                ['L', g, m],
                ['L', a + q, r / 2],
                ['L', a + q, u + r - v],
              )
          : 0 >= a + g
            ? m > u + h && m < u + r - h
              ? d.splice(
                  7,
                  1,
                  ['L', a, m + 6],
                  ['L', a - 6, m],
                  ['L', a, m - 6],
                  ['L', a, u + v],
                )
              : d.splice(
                  7,
                  1,
                  ['L', a, r / 2],
                  ['L', g, m],
                  ['L', a, r / 2],
                  ['L', a, u + v],
                )
            : m && m > r && g > a + h && g < a + q - h
              ? d.splice(
                  5,
                  1,
                  ['L', g + 6, u + r],
                  ['L', g, u + r + 6],
                  ['L', g - 6, u + r],
                  ['L', a + v, u + r],
                )
              : m &&
                0 > m &&
                g > a + h &&
                g < a + q - h &&
                d.splice(
                  1,
                  1,
                  ['L', g - 6, u],
                  ['L', g, u - 6],
                  ['L', g + 6, u],
                  ['L', q - v, u],
                );
        return d;
      },
      circle: function (a, u, q, r) {
        return x(a + q / 2, u + r / 2, q / 2, r / 2, {
          start: 0.5 * Math.PI,
          end: 2.5 * Math.PI,
          open: !1,
        });
      },
      diamond: function (a, u, q, r) {
        return [
          ['M', a + q / 2, u],
          ['L', a + q, u + r / 2],
          ['L', a + q / 2, u + r],
          ['L', a, u + r / 2],
          ['Z'],
        ];
      },
      rect: G,
      roundedRect: H,
      square: G,
      triangle: function (a, u, q, r) {
        return [
          ['M', a + q / 2, u],
          ['L', a + q, u + r],
          ['L', a, u + r],
          ['Z'],
        ];
      },
      'triangle-down': function (a, u, q, r) {
        return [['M', a, u], ['L', a + q, u], ['L', a + q / 2, u + r], ['Z']];
      },
    };
  });
  M(
    a,
    'Core/Renderer/SVG/TextBuilder.js',
    [
      a['Core/Renderer/HTML/AST.js'],
      a['Core/Globals.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { doc: x, SVG_NS: C, win: z } = A,
        {
          attr: D,
          extend: B,
          fireEvent: u,
          isString: q,
          objectEach: r,
          pick: m,
        } = G;
      class v {
        constructor(a) {
          const g = a.styles;
          this.renderer = a.renderer;
          this.svgElement = a;
          this.width = a.textWidth;
          this.textLineHeight = g && g.lineHeight;
          this.textOutline = g && g.textOutline;
          this.ellipsis = !(!g || 'ellipsis' !== g.textOverflow);
          this.noWrap = !(!g || 'nowrap' !== g.whiteSpace);
        }
        buildSVG() {
          const h = this.svgElement,
            g = h.element;
          var d = h.renderer,
            k = m(h.textStr, '').toString();
          const y = -1 !== k.indexOf('<'),
            v = g.childNodes;
          d = !h.added && d.box;
          const r = /<br.*?>/g;
          var f = [
            k,
            this.ellipsis,
            this.noWrap,
            this.textLineHeight,
            this.textOutline,
            h.getStyle('font-size'),
            this.width,
          ].join();
          if (f !== h.textCache) {
            h.textCache = f;
            delete h.actualWidth;
            for (f = v.length; f--; ) g.removeChild(v[f]);
            y ||
            this.ellipsis ||
            this.width ||
            h.textPath ||
            (-1 !== k.indexOf(' ') && (!this.noWrap || r.test(k)))
              ? '' !== k &&
                (d && d.appendChild(g),
                (k = new a(k)),
                this.modifyTree(k.nodes),
                k.addToDOM(g),
                this.modifyDOM(),
                this.ellipsis &&
                  -1 !== (g.textContent || '').indexOf('\u2026') &&
                  h.attr(
                    'title',
                    this.unescapeEntities(h.textStr || '', ['&lt;', '&gt;']),
                  ),
                d && d.removeChild(g))
              : g.appendChild(x.createTextNode(this.unescapeEntities(k)));
            q(this.textOutline) &&
              h.applyTextOutline &&
              h.applyTextOutline(this.textOutline);
          }
        }
        modifyDOM() {
          const a = this.svgElement,
            g = D(a.element, 'x');
          a.firstLineMetrics = void 0;
          let d;
          for (; (d = a.element.firstChild); )
            if (/^[\s\u200B]*$/.test(d.textContent || ' '))
              a.element.removeChild(d);
            else break;
          [].forEach.call(
            a.element.querySelectorAll('tspan.highcharts-br'),
            (d, f) => {
              d.nextSibling &&
                d.previousSibling &&
                (0 === f &&
                  1 === d.previousSibling.nodeType &&
                  (a.firstLineMetrics = a.renderer.fontMetrics(
                    d.previousSibling,
                  )),
                D(d, { dy: this.getLineHeight(d.nextSibling), x: g }));
            },
          );
          const k = this.width || 0;
          if (k) {
            var y = (d, f) => {
                var p = d.textContent || '';
                const t = p.replace(/([^\^])-/g, '$1- ').split(' ');
                var n =
                  !this.noWrap &&
                  (1 < t.length || 1 < a.element.childNodes.length);
                const w = this.getLineHeight(f);
                let e = 0,
                  b = a.actualWidth;
                if (this.ellipsis)
                  p &&
                    this.truncate(
                      d,
                      p,
                      void 0,
                      0,
                      Math.max(0, k - 0.8 * w),
                      (b, e) => b.substring(0, e) + '\u2026',
                    );
                else if (n) {
                  p = [];
                  for (n = []; f.firstChild && f.firstChild !== d; )
                    (n.push(f.firstChild), f.removeChild(f.firstChild));
                  for (; t.length; )
                    (t.length &&
                      !this.noWrap &&
                      0 < e &&
                      (p.push(d.textContent || ''),
                      (d.textContent = t.join(' ').replace(/- /g, '-'))),
                      this.truncate(
                        d,
                        void 0,
                        t,
                        0 === e ? b || 0 : 0,
                        k,
                        (b, e) => t.slice(0, e).join(' ').replace(/- /g, '-'),
                      ),
                      (b = a.actualWidth),
                      e++);
                  n.forEach((b) => {
                    f.insertBefore(b, d);
                  });
                  p.forEach((b) => {
                    f.insertBefore(x.createTextNode(b), d);
                    b = x.createElementNS(C, 'tspan');
                    b.textContent = '\u200b';
                    D(b, { dy: w, x: g });
                    f.insertBefore(b, d);
                  });
                }
              },
              m = (d) => {
                [].slice.call(d.childNodes).forEach((f) => {
                  f.nodeType === z.Node.TEXT_NODE
                    ? y(f, d)
                    : (-1 !== f.className.baseVal.indexOf('highcharts-br') &&
                        (a.actualWidth = 0),
                      m(f));
                });
              };
            m(a.element);
          }
        }
        getLineHeight(a) {
          a = a.nodeType === z.Node.TEXT_NODE ? a.parentElement : a;
          return this.textLineHeight
            ? parseInt(this.textLineHeight.toString(), 10)
            : this.renderer.fontMetrics(a || this.svgElement.element).h;
        }
        modifyTree(a) {
          const g = (d, k) => {
            const {
                attributes: h = {},
                children: m,
                style: q = {},
                tagName: f,
              } = d,
              p = this.renderer.styledMode;
            if ('b' === f || 'strong' === f)
              p ? (h['class'] = 'highcharts-strong') : (q.fontWeight = 'bold');
            else if ('i' === f || 'em' === f)
              p
                ? (h['class'] = 'highcharts-emphasized')
                : (q.fontStyle = 'italic');
            q && q.color && (q.fill = q.color);
            'br' === f
              ? ((h['class'] = 'highcharts-br'),
                (d.textContent = '\u200b'),
                (k = a[k + 1]) &&
                  k.textContent &&
                  (k.textContent = k.textContent.replace(/^ +/gm, '')))
              : 'a' === f &&
                m &&
                m.some((f) => '#text' === f.tagName) &&
                (d.children = [{ children: m, tagName: 'tspan' }]);
            '#text' !== f && 'a' !== f && (d.tagName = 'tspan');
            B(d, { attributes: h, style: q });
            m && m.filter((f) => '#text' !== f.tagName).forEach(g);
          };
          a.forEach(g);
          u(this.svgElement, 'afterModifyTree', { nodes: a });
        }
        truncate(a, g, d, k, y, m) {
          const h = this.svgElement,
            { rotation: f } = h,
            p = [];
          let t = d ? 1 : 0,
            n = (g || d || '').length,
            w = n,
            e,
            b;
          const c = function (b, c) {
            b = c || b;
            if (
              (c = a.parentNode) &&
              'undefined' === typeof p[b] &&
              c.getSubStringLength
            )
              try {
                p[b] = k + c.getSubStringLength(0, d ? b + 1 : b);
              } catch (F) {
                ('');
              }
            return p[b];
          };
          h.rotation = 0;
          b = c(a.textContent.length);
          if (k + b > y) {
            for (; t <= n; )
              ((w = Math.ceil((t + n) / 2)),
                d && (e = m(d, w)),
                (b = c(w, e && e.length - 1)),
                t === n ? (t = n + 1) : b > y ? (n = w - 1) : (t = w));
            0 === n
              ? (a.textContent = '')
              : (g && n === g.length - 1) ||
                (a.textContent = e || m(g || d, w));
          }
          d && d.splice(0, w);
          h.actualWidth = b;
          h.rotation = f;
        }
        unescapeEntities(a, g) {
          r(this.renderer.escapes, function (d, k) {
            (g && -1 !== g.indexOf(d)) ||
              (a = a.toString().replace(new RegExp(d, 'g'), k));
          });
          return a;
        }
      }
      return v;
    },
  );
  M(
    a,
    'Core/Renderer/SVG/SVGRenderer.js',
    [
      a['Core/Renderer/HTML/AST.js'],
      a['Core/Color/Color.js'],
      a['Core/Globals.js'],
      a['Core/Renderer/RendererRegistry.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Renderer/SVG/SVGLabel.js'],
      a['Core/Renderer/SVG/Symbols.js'],
      a['Core/Renderer/SVG/TextBuilder.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D, B, u) {
      const {
          charts: q,
          deg2rad: r,
          doc: m,
          isFirefox: v,
          isMS: h,
          isWebKit: g,
          noop: d,
          SVG_NS: k,
          symbolSizes: y,
          win: K,
        } = G,
        {
          addEvent: L,
          attr: f,
          createElement: p,
          css: t,
          defined: n,
          destroyObjectProperties: w,
          extend: e,
          isArray: b,
          isNumber: c,
          isObject: l,
          isString: I,
          merge: F,
          pick: J,
          pInt: S,
          uniqueKey: P,
        } = u;
      let O;
      class Q {
        constructor(b, c, e, l, f, n, d) {
          this.width =
            this.url =
            this.style =
            this.imgCount =
            this.height =
            this.gradients =
            this.globalAnimation =
            this.defs =
            this.chartIndex =
            this.cacheKeys =
            this.cache =
            this.boxWrapper =
            this.box =
            this.alignedObjects =
              void 0;
          this.init(b, c, e, l, f, n, d);
        }
        init(b, c, e, l, n, d, p) {
          const E = this.createElement('svg').attr({
              version: '1.1',
              class: 'highcharts-root',
            }),
            a = E.element;
          p || E.css(this.getStyle(l));
          b.appendChild(a);
          f(b, 'dir', 'ltr');
          -1 === b.innerHTML.indexOf('xmlns') && f(a, 'xmlns', this.SVG_NS);
          this.box = a;
          this.boxWrapper = E;
          this.alignedObjects = [];
          this.url = this.getReferenceURL();
          this.createElement('desc')
            .add()
            .element.appendChild(
              m.createTextNode('Created with Highcharts 11.1.0'),
            );
          this.defs = this.createElement('defs').add();
          this.allowHTML = d;
          this.forExport = n;
          this.styledMode = p;
          this.gradients = {};
          this.cache = {};
          this.cacheKeys = [];
          this.imgCount = 0;
          this.rootFontSize = E.getStyle('font-size');
          this.setSize(c, e, !1);
          let w;
          v &&
            b.getBoundingClientRect &&
            ((c = function () {
              t(b, { left: 0, top: 0 });
              w = b.getBoundingClientRect();
              t(b, {
                left: Math.ceil(w.left) - w.left + 'px',
                top: Math.ceil(w.top) - w.top + 'px',
              });
            }),
            c(),
            (this.unSubPixelFix = L(K, 'resize', c)));
        }
        definition(b) {
          return new a([b]).addToDOM(this.defs.element);
        }
        getReferenceURL() {
          if ((v || g) && m.getElementsByTagName('base').length) {
            if (!n(O)) {
              var b = P();
              b = new a([
                {
                  tagName: 'svg',
                  attributes: { width: 8, height: 8 },
                  children: [
                    {
                      tagName: 'defs',
                      children: [
                        {
                          tagName: 'clipPath',
                          attributes: { id: b },
                          children: [
                            {
                              tagName: 'rect',
                              attributes: { width: 4, height: 4 },
                            },
                          ],
                        },
                      ],
                    },
                    {
                      tagName: 'rect',
                      attributes: {
                        id: 'hitme',
                        width: 8,
                        height: 8,
                        'clip-path': `url(#${b})`,
                        fill: 'rgba(0,0,0,0.001)',
                      },
                    },
                  ],
                },
              ]).addToDOM(m.body);
              t(b, { position: 'fixed', top: 0, left: 0, zIndex: 9e5 });
              const c = m.elementFromPoint(6, 6);
              O = 'hitme' === (c && c.id);
              m.body.removeChild(b);
            }
            if (O)
              return K.location.href
                .split('#')[0]
                .replace(/<[^>]*>/g, '')
                .replace(/([\('\)])/g, '\\$1')
                .replace(/ /g, '%20');
          }
          return '';
        }
        getStyle(b) {
          return (this.style = e(
            { fontFamily: 'Helvetica, Arial, sans-serif', fontSize: '1rem' },
            b,
          ));
        }
        setStyle(b) {
          this.boxWrapper.css(this.getStyle(b));
        }
        isHidden() {
          return !this.boxWrapper.getBBox().width;
        }
        destroy() {
          const b = this.defs;
          this.box = null;
          this.boxWrapper = this.boxWrapper.destroy();
          w(this.gradients || {});
          this.gradients = null;
          this.defs = b.destroy();
          this.unSubPixelFix && this.unSubPixelFix();
          return (this.alignedObjects = null);
        }
        createElement(b) {
          const c = new this.Element();
          c.init(this, b);
          return c;
        }
        getRadialAttr(b, c) {
          return {
            cx: b[0] - b[2] / 2 + (c.cx || 0) * b[2],
            cy: b[1] - b[2] / 2 + (c.cy || 0) * b[2],
            r: (c.r || 0) * b[2],
          };
        }
        shadowDefinition(b) {
          const c = [
              `highcharts-drop-shadow-${this.chartIndex}`,
              ...Object.keys(b).map((c) => b[c]),
            ]
              .join('-')
              .replace(/[^a-z0-9\-]/g, ''),
            e = F(
              {
                color: '#000000',
                offsetX: 1,
                offsetY: 1,
                opacity: 0.15,
                width: 5,
              },
              b,
            );
          this.defs.element.querySelector(`#${c}`) ||
            this.definition({
              tagName: 'filter',
              attributes: { id: c },
              children: [
                {
                  tagName: 'feDropShadow',
                  attributes: {
                    dx: e.offsetX,
                    dy: e.offsetY,
                    'flood-color': e.color,
                    'flood-opacity': Math.min(5 * e.opacity, 1),
                    stdDeviation: e.width / 2,
                  },
                },
              ],
            });
          return c;
        }
        buildText(b) {
          new B(b).buildSVG();
        }
        getContrast(b) {
          b = A.parse(b).rgba.map((b) => {
            b /= 255;
            return 0.03928 >= b
              ? b / 12.92
              : Math.pow((b + 0.055) / 1.055, 2.4);
          });
          b = 0.2126 * b[0] + 0.7152 * b[1] + 0.0722 * b[2];
          return 1.05 / (b + 0.05) > (b + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
        }
        button(b, c, f, n, d = {}, p, t, w, k, g) {
          const E = this.label(b, c, f, k, void 0, void 0, g, void 0, 'button'),
            N = this.styledMode;
          b = d.states || {};
          let I = 0;
          d = F(d);
          delete d.states;
          const y = F(
            {
              color: '#333333',
              cursor: 'pointer',
              fontSize: '0.8em',
              fontWeight: 'normal',
            },
            d.style,
          );
          delete d.style;
          let J = a.filterUserAttributes(d);
          E.attr(F({ padding: 8, r: 2 }, J));
          let m, q, v;
          N ||
            ((J = F(
              { fill: '#f7f7f7', stroke: '#cccccc', 'stroke-width': 1 },
              J,
            )),
            (p = F(
              J,
              { fill: '#e6e6e6' },
              a.filterUserAttributes(p || b.hover || {}),
            )),
            (m = p.style),
            delete p.style,
            (t = F(
              J,
              {
                fill: '#e6e9ff',
                style: { color: '#000000', fontWeight: 'bold' },
              },
              a.filterUserAttributes(t || b.select || {}),
            )),
            (q = t.style),
            delete t.style,
            (w = F(
              J,
              { style: { color: '#cccccc' } },
              a.filterUserAttributes(w || b.disabled || {}),
            )),
            (v = w.style),
            delete w.style);
          L(E.element, h ? 'mouseover' : 'mouseenter', function () {
            3 !== I && E.setState(1);
          });
          L(E.element, h ? 'mouseout' : 'mouseleave', function () {
            3 !== I && E.setState(I);
          });
          E.setState = function (b) {
            1 !== b && (E.state = I = b);
            E.removeClass(
              /highcharts-button-(normal|hover|pressed|disabled)/,
            ).addClass(
              'highcharts-button-' +
                ['normal', 'hover', 'pressed', 'disabled'][b || 0],
            );
            N ||
              (E.attr([J, p, t, w][b || 0]),
              (b = [y, m, q, v][b || 0]),
              l(b) && E.css(b));
          };
          N ||
            (E.attr(J).css(e({ cursor: 'default' }, y)),
            g && E.text.css({ pointerEvents: 'none' }));
          return E.on('touchstart', (b) => b.stopPropagation()).on(
            'click',
            function (b) {
              3 !== I && n.call(E, b);
            },
          );
        }
        crispLine(b, c, e = 'round') {
          const l = b[0],
            f = b[1];
          n(l[1]) &&
            l[1] === f[1] &&
            (l[1] = f[1] = Math[e](l[1]) - (c % 2) / 2);
          n(l[2]) &&
            l[2] === f[2] &&
            (l[2] = f[2] = Math[e](l[2]) + (c % 2) / 2);
          return b;
        }
        path(c) {
          const f = this.styledMode ? {} : { fill: 'none' };
          b(c) ? (f.d = c) : l(c) && e(f, c);
          return this.createElement('path').attr(f);
        }
        circle(b, c, e) {
          b = l(b) ? b : 'undefined' === typeof b ? {} : { x: b, y: c, r: e };
          c = this.createElement('circle');
          c.xSetter = c.ySetter = function (b, c, e) {
            e.setAttribute('c' + c, b);
          };
          return c.attr(b);
        }
        arc(b, c, e, f, n, d) {
          l(b)
            ? ((f = b), (c = f.y), (e = f.r), (b = f.x))
            : (f = { innerR: f, start: n, end: d });
          b = this.symbol('arc', b, c, e, e, f);
          b.r = e;
          return b;
        }
        rect(b, c, n, d, p, a) {
          b = l(b)
            ? b
            : 'undefined' === typeof b
              ? {}
              : {
                  x: b,
                  y: c,
                  r: p,
                  width: Math.max(n || 0, 0),
                  height: Math.max(d || 0, 0),
                };
          const E = this.createElement('rect');
          this.styledMode ||
            ('undefined' !== typeof a &&
              ((b['stroke-width'] = a), e(b, E.crisp(b))),
            (b.fill = 'none'));
          E.rSetter = function (b, c, e) {
            E.r = b;
            f(e, { rx: b, ry: b });
          };
          E.rGetter = function () {
            return E.r || 0;
          };
          return E.attr(b);
        }
        roundedRect(b) {
          return this.symbol('roundedRect').attr(b);
        }
        setSize(b, c, e) {
          this.width = b;
          this.height = c;
          this.boxWrapper.animate(
            { width: b, height: c },
            {
              step: function () {
                this.attr({
                  viewBox:
                    '0 0 ' + this.attr('width') + ' ' + this.attr('height'),
                });
              },
              duration: J(e, !0) ? void 0 : 0,
            },
          );
          this.alignElements();
        }
        g(b) {
          const c = this.createElement('g');
          return b ? c.attr({ class: 'highcharts-' + b }) : c;
        }
        image(b, e, l, f, n, d) {
          const E = { preserveAspectRatio: 'none' };
          c(e) && (E.x = e);
          c(l) && (E.y = l);
          c(f) && (E.width = f);
          c(n) && (E.height = n);
          const p = this.createElement('image').attr(E);
          e = function (c) {
            p.attr({ href: b });
            d.call(p, c);
          };
          d
            ? (p.attr({
                href: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
              }),
              (l = new K.Image()),
              L(l, 'load', e),
              (l.src = b),
              l.complete && e({}))
            : p.attr({ href: b });
          return p;
        }
        symbol(b, c, l, d, a, w) {
          const E = this,
            k = /^url\((.*?)\)$/,
            g = k.test(b),
            F = !g && (this.symbols[b] ? b : 'circle'),
            I = F && this.symbols[F];
          let h, v, r, O;
          if (I)
            ('number' === typeof c &&
              (v = I.call(
                this.symbols,
                Math.round(c || 0),
                Math.round(l || 0),
                d || 0,
                a || 0,
                w,
              )),
              (h = this.path(v)),
              E.styledMode || h.attr('fill', 'none'),
              e(h, {
                symbolName: F || void 0,
                x: c,
                y: l,
                width: d,
                height: a,
              }),
              w && e(h, w));
          else if (g) {
            r = b.match(k)[1];
            const e = (h = this.image(r));
            e.imgwidth = J(w && w.width, y[r] && y[r].width);
            e.imgheight = J(w && w.height, y[r] && y[r].height);
            O = (b) => b.attr({ width: b.width, height: b.height });
            ['width', 'height'].forEach(function (b) {
              e[b + 'Setter'] = function (b, c) {
                this[c] = b;
                const {
                  alignByTranslate: e,
                  element: l,
                  width: E,
                  height: d,
                  imgwidth: p,
                  imgheight: a,
                } = this;
                b = this['img' + c];
                if (n(b)) {
                  let n = 1;
                  w && 'within' === w.backgroundSize && E && d
                    ? ((n = Math.min(E / p, d / a)),
                      f(l, {
                        width: Math.round(p * n),
                        height: Math.round(a * n),
                      }))
                    : l && l.setAttribute(c, b);
                  e ||
                    this.translate(
                      ((E || 0) - p * n) / 2,
                      ((d || 0) - a * n) / 2,
                    );
                }
              };
            });
            n(c) && e.attr({ x: c, y: l });
            e.isImg = !0;
            n(e.imgwidth) && n(e.imgheight)
              ? O(e)
              : (e.attr({ width: 0, height: 0 }),
                p('img', {
                  onload: function () {
                    const b = q[E.chartIndex];
                    0 === this.width &&
                      (t(this, { position: 'absolute', top: '-999em' }),
                      m.body.appendChild(this));
                    y[r] = { width: this.width, height: this.height };
                    e.imgwidth = this.width;
                    e.imgheight = this.height;
                    e.element && O(e);
                    this.parentNode && this.parentNode.removeChild(this);
                    E.imgCount--;
                    if (!E.imgCount && b && !b.hasLoaded) b.onload();
                  },
                  src: r,
                }),
                this.imgCount++);
          }
          return h;
        }
        clipRect(b, c, e, l) {
          const f = P() + '-',
            E = this.createElement('clipPath').attr({ id: f }).add(this.defs);
          b = this.rect(b, c, e, l, 0).add(E);
          b.id = f;
          b.clipPath = E;
          b.count = 0;
          return b;
        }
        text(b, c, e, l) {
          const f = {};
          if (l && (this.allowHTML || !this.forExport))
            return this.html(b, c, e);
          f.x = Math.round(c || 0);
          e && (f.y = Math.round(e));
          n(b) && (f.text = b);
          b = this.createElement('text').attr(f);
          if (!l || (this.forExport && !this.allowHTML))
            b.xSetter = function (b, c, e) {
              const l = e.getElementsByTagName('tspan'),
                f = e.getAttribute(c);
              for (let e = 0, E; e < l.length; e++)
                ((E = l[e]), E.getAttribute(c) === f && E.setAttribute(c, b));
              e.setAttribute(c, b);
            };
          return b;
        }
        fontMetrics(b) {
          b = S(C.prototype.getStyle.call(b, 'font-size') || 0);
          const c = 24 > b ? b + 3 : Math.round(1.2 * b);
          return { h: c, b: Math.round(0.8 * c), f: b };
        }
        rotCorr(b, c, e) {
          let l = b;
          c && e && (l = Math.max(l * Math.cos(c * r), 4));
          return { x: (-b / 3) * Math.sin(c * r), y: l };
        }
        pathToSegments(b) {
          const e = [],
            l = [],
            f = { A: 8, C: 7, H: 2, L: 3, M: 3, Q: 5, S: 5, T: 3, V: 2 };
          for (let n = 0; n < b.length; n++)
            (I(l[0]) &&
              c(b[n]) &&
              l.length === f[l[0].toUpperCase()] &&
              b.splice(n, 0, l[0].replace('M', 'L').replace('m', 'l')),
              'string' === typeof b[n] &&
                (l.length && e.push(l.slice(0)), (l.length = 0)),
              l.push(b[n]));
          e.push(l.slice(0));
          return e;
        }
        label(b, c, e, l, f, n, d, p, a) {
          return new z(this, b, c, e, l, f, n, d, p, a);
        }
        alignElements() {
          this.alignedObjects.forEach((b) => b.align());
        }
      }
      e(Q.prototype, {
        Element: C,
        SVG_NS: k,
        escapes: {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;',
        },
        symbols: D,
        draw: d,
      });
      H.registerRendererType('svg', Q, !0);
      ('');
      return Q;
    },
  );
  M(
    a,
    'Core/Renderer/HTML/HTMLElement.js',
    [
      a['Core/Globals.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { isFirefox: x, isMS: C, isWebKit: z, win: D } = a,
        { css: B, defined: u, extend: q, pick: r, pInt: m } = G,
        v = [];
      class h extends A {
        static compose(a) {
          if (G.pushUnique(v, a)) {
            const d = h.prototype,
              k = a.prototype;
            k.getSpanCorrection = d.getSpanCorrection;
            k.htmlCss = d.htmlCss;
            k.htmlGetBBox = d.htmlGetBBox;
            k.htmlUpdateTransform = d.htmlUpdateTransform;
            k.setSpanRotation = d.setSpanRotation;
          }
          return a;
        }
        getSpanCorrection(a, d, k) {
          this.xCorr = -a * k;
          this.yCorr = -d;
        }
        htmlCss(a) {
          const d = 'SPAN' === this.element.tagName && a && 'width' in a,
            k = r(d && a.width, void 0);
          let g;
          d && (delete a.width, (this.textWidth = k), (g = !0));
          a &&
            'ellipsis' === a.textOverflow &&
            ((a.whiteSpace = 'nowrap'), (a.overflow = 'hidden'));
          this.styles = q(this.styles, a);
          B(this.element, a);
          g && this.htmlUpdateTransform();
          return this;
        }
        htmlGetBBox() {
          const a = this.element;
          return {
            x: a.offsetLeft,
            y: a.offsetTop,
            width: a.offsetWidth,
            height: a.offsetHeight,
          };
        }
        htmlUpdateTransform() {
          if (this.added) {
            var a = this.renderer,
              d = this.element,
              k = this.x || 0,
              h = this.y || 0,
              q = this.textAlign || 'left',
              r = { left: 0, center: 0.5, right: 1 }[q],
              f = this.styles,
              p = f && f.whiteSpace;
            B(d, {
              marginLeft: this.translateX || 0,
              marginTop: this.translateY || 0,
            });
            if ('SPAN' === d.tagName) {
              f = this.rotation;
              const n = this.textWidth && m(this.textWidth),
                w = [f, q, d.innerHTML, this.textWidth, this.textAlign].join();
              let e = !1;
              if (n !== this.oldTextWidth) {
                if (this.textPxLength) var t = this.textPxLength;
                else
                  (B(d, { width: '', whiteSpace: p || 'nowrap' }),
                    (t = d.offsetWidth));
                (n > this.oldTextWidth || t > n) &&
                  (/[ \-]/.test(d.textContent || d.innerText) ||
                    'ellipsis' === d.style.textOverflow) &&
                  (B(d, {
                    width: t > n || f ? n + 'px' : 'auto',
                    display: 'block',
                    whiteSpace: p || 'normal',
                  }),
                  (this.oldTextWidth = n),
                  (e = !0));
              }
              this.hasBoxWidthChanged = e;
              w !== this.cTT &&
                ((a = a.fontMetrics(d).b),
                !u(f) ||
                  (f === (this.oldRotation || 0) && q === this.oldAlign) ||
                  this.setSpanRotation(f, r, a),
                this.getSpanCorrection(
                  (!u(f) && this.textPxLength) || d.offsetWidth,
                  a,
                  r,
                  f,
                  q,
                ));
              B(d, {
                left: k + (this.xCorr || 0) + 'px',
                top: h + (this.yCorr || 0) + 'px',
              });
              this.cTT = w;
              this.oldRotation = f;
              this.oldAlign = q;
            }
          } else this.alignOnAdd = !0;
        }
        setSpanRotation(a, d, k) {
          const g = {},
            h =
              C && !/Edge/.test(D.navigator.userAgent)
                ? '-ms-transform'
                : z
                  ? '-webkit-transform'
                  : x
                    ? 'MozTransform'
                    : D.opera
                      ? '-o-transform'
                      : void 0;
          h &&
            ((g[h] = g.transform = 'rotate(' + a + 'deg)'),
            (g[h + (x ? 'Origin' : '-origin')] = g.transformOrigin =
              100 * d + '% ' + k + 'px'),
            B(this.element, g));
        }
      }
      return h;
    },
  );
  M(
    a,
    'Core/Renderer/HTML/HTMLRenderer.js',
    [
      a['Core/Renderer/HTML/AST.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Renderer/SVG/SVGRenderer.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H) {
      const { attr: x, createElement: z, extend: D, pick: B } = H,
        u = [];
      class q extends G {
        static compose(a) {
          H.pushUnique(u, a) && (a.prototype.html = q.prototype.html);
          return a;
        }
        html(q, m, v) {
          const h = this.createElement('span'),
            g = h.element,
            d = h.renderer,
            k = function (d, a) {
              ['opacity', 'visibility'].forEach(function (k) {
                d[k + 'Setter'] = function (f, p, t) {
                  const n = d.div ? d.div.style : a;
                  A.prototype[k + 'Setter'].call(this, f, p, t);
                  n && (n[p] = f);
                };
              });
              d.addedSetters = !0;
            };
          h.textSetter = function (d) {
            d !== this.textStr &&
              (delete this.bBox,
              delete this.oldTextWidth,
              a.setElementHTML(this.element, B(d, '')),
              (this.textStr = d),
              (h.doTransform = !0));
          };
          k(h, h.element.style);
          h.xSetter =
            h.ySetter =
            h.alignSetter =
            h.rotationSetter =
              function (d, a) {
                'align' === a ? (h.alignValue = h.textAlign = d) : (h[a] = d);
                h.doTransform = !0;
              };
          h.afterSetters = function () {
            this.doTransform &&
              (this.htmlUpdateTransform(), (this.doTransform = !1));
          };
          h.attr({ text: q, x: Math.round(m), y: Math.round(v) }).css({
            position: 'absolute',
          });
          d.styledMode ||
            h.css({
              fontFamily: this.style.fontFamily,
              fontSize: this.style.fontSize,
            });
          g.style.whiteSpace = 'nowrap';
          h.css = h.htmlCss;
          h.add = function (a) {
            const m = d.box.parentNode,
              y = [];
            let f;
            if ((this.parentGroup = a)) {
              if (((f = a.div), !f)) {
                for (; a; ) (y.push(a), (a = a.parentGroup));
                y.reverse().forEach(function (d) {
                  function a(b, c) {
                    d[c] = b;
                    'translateX' === c
                      ? (e.left = b + 'px')
                      : (e.top = b + 'px');
                    d.doTransform = !0;
                  }
                  const n = x(d.element, 'class'),
                    p = d.styles || {};
                  f = d.div =
                    d.div ||
                    z(
                      'div',
                      n ? { className: n } : void 0,
                      {
                        position: 'absolute',
                        left: (d.translateX || 0) + 'px',
                        top: (d.translateY || 0) + 'px',
                        display: d.display,
                        opacity: d.opacity,
                        visibility: d.visibility,
                      },
                      f || m,
                    );
                  const e = f.style;
                  D(d, {
                    classSetter: (function (b) {
                      return function (c) {
                        this.element.setAttribute('class', c);
                        b.className = c;
                      };
                    })(f),
                    css: function (b) {
                      h.css.call(d, b);
                      ['cursor', 'pointerEvents'].forEach((c) => {
                        b[c] && (e[c] = b[c]);
                      });
                      return d;
                    },
                    on: function () {
                      y[0].div &&
                        h.on.apply(
                          { element: y[0].div, onEvents: d.onEvents },
                          arguments,
                        );
                      return d;
                    },
                    translateXSetter: a,
                    translateYSetter: a,
                  });
                  d.addedSetters || k(d);
                  d.css(p);
                });
              }
            } else f = m;
            f.appendChild(g);
            h.added = !0;
            h.alignOnAdd && h.htmlUpdateTransform();
            return h;
          };
          return h;
        }
      }
      return q;
    },
  );
  M(a, 'Core/Axis/AxisDefaults.js', [], function () {
    var a;
    (function (a) {
      a.defaultXAxisOptions = {
        alignTicks: !0,
        allowDecimals: void 0,
        panningEnabled: !0,
        zIndex: 2,
        zoomEnabled: !0,
        dateTimeLabelFormats: {
          millisecond: { main: '%H:%M:%S.%L', range: !1 },
          second: { main: '%H:%M:%S', range: !1 },
          minute: { main: '%H:%M', range: !1 },
          hour: { main: '%H:%M', range: !1 },
          day: { main: '%e %b' },
          week: { main: '%e %b' },
          month: { main: "%b '%y" },
          year: { main: '%Y' },
        },
        endOnTick: !1,
        gridLineDashStyle: 'Solid',
        gridZIndex: 1,
        labels: {
          autoRotation: void 0,
          autoRotationLimit: 80,
          distance: 15,
          enabled: !0,
          indentation: 10,
          overflow: 'justify',
          padding: 5,
          reserveSpace: void 0,
          rotation: void 0,
          staggerLines: 0,
          step: 0,
          useHTML: !1,
          zIndex: 7,
          style: { color: '#333333', cursor: 'default', fontSize: '0.8em' },
        },
        maxPadding: 0.01,
        minorGridLineDashStyle: 'Solid',
        minorTickLength: 2,
        minorTickPosition: 'outside',
        minorTicksPerMajor: 5,
        minPadding: 0.01,
        offset: void 0,
        opposite: !1,
        reversed: void 0,
        reversedStacks: !1,
        showEmpty: !0,
        showFirstLabel: !0,
        showLastLabel: !0,
        startOfWeek: 1,
        startOnTick: !1,
        tickLength: 10,
        tickPixelInterval: 100,
        tickmarkPlacement: 'between',
        tickPosition: 'outside',
        title: {
          align: 'middle',
          rotation: 0,
          useHTML: !1,
          x: 0,
          y: 0,
          style: { color: '#666666', fontSize: '0.8em' },
        },
        type: 'linear',
        uniqueNames: !0,
        visible: !0,
        minorGridLineColor: '#f2f2f2',
        minorGridLineWidth: 1,
        minorTickColor: '#999999',
        lineColor: '#333333',
        lineWidth: 1,
        gridLineColor: '#e6e6e6',
        gridLineWidth: void 0,
        tickColor: '#333333',
      };
      a.defaultYAxisOptions = {
        reversedStacks: !0,
        endOnTick: !0,
        maxPadding: 0.05,
        minPadding: 0.05,
        tickPixelInterval: 72,
        showLastLabel: !0,
        labels: { x: void 0 },
        startOnTick: !0,
        title: { rotation: 270, text: 'Values' },
        stackLabels: {
          animation: {},
          allowOverlap: !1,
          enabled: !1,
          crop: !0,
          overflow: 'justify',
          formatter: function () {
            const { numberFormatter: a } = this.axis.chart;
            return a(this.total || 0, -1);
          },
          style: {
            color: '#000000',
            fontSize: '0.7em',
            fontWeight: 'bold',
            textOutline: '1px contrast',
          },
        },
        gridLineWidth: 1,
        lineWidth: 0,
      };
      a.defaultLeftAxisOptions = { title: { rotation: 270 } };
      a.defaultRightAxisOptions = { title: { rotation: 90 } };
      a.defaultBottomAxisOptions = {
        labels: { autoRotation: [-45] },
        margin: 15,
        title: { rotation: 0 },
      };
      a.defaultTopAxisOptions = {
        labels: { autoRotation: [-45] },
        margin: 15,
        title: { rotation: 0 },
      };
    })(a || (a = {}));
    return a;
  });
  M(a, 'Core/Foundation.js', [a['Core/Utilities.js']], function (a) {
    const { addEvent: x, isFunction: G, objectEach: H, removeEvent: C } = a;
    var z;
    (function (a) {
      a.registerEventOptions = function (a, u) {
        a.eventOptions = a.eventOptions || {};
        H(u.events, function (q, r) {
          a.eventOptions[r] !== q &&
            (a.eventOptions[r] &&
              (C(a, r, a.eventOptions[r]), delete a.eventOptions[r]),
            G(q) && ((a.eventOptions[r] = q), x(a, r, q, { order: 0 })));
        });
      };
    })(z || (z = {}));
    return z;
  });
  M(
    a,
    'Core/Axis/Tick.js',
    [a['Core/Templating.js'], a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      const { deg2rad: x } = A,
        {
          clamp: C,
          correctFloat: z,
          defined: D,
          destroyObjectProperties: B,
          extend: u,
          fireEvent: q,
          isNumber: r,
          merge: m,
          objectEach: v,
          pick: h,
        } = G;
      class g {
        constructor(a, k, g, h, m) {
          this.isNewLabel = this.isNew = !0;
          this.axis = a;
          this.pos = k;
          this.type = g || '';
          this.parameters = m || {};
          this.tickmarkOffset = this.parameters.tickmarkOffset;
          this.options = this.parameters.options;
          q(this, 'init');
          g || h || this.addLabel();
        }
        addLabel() {
          const d = this,
            k = d.axis;
          var g = k.options;
          const m = k.chart;
          var v = k.categories;
          const f = k.logarithmic,
            p = k.names,
            t = d.pos,
            n = h(d.options && d.options.labels, g.labels);
          var w = k.tickPositions;
          const e = t === w[0],
            b = t === w[w.length - 1],
            c = (!n.step || 1 === n.step) && 1 === k.tickInterval;
          w = w.info;
          let l = d.label,
            I,
            F,
            J;
          v = this.parameters.category || (v ? h(v[t], p[t], t) : t);
          f && r(v) && (v = z(f.lin2log(v)));
          k.dateTime &&
            (w
              ? ((F = m.time.resolveDTLFormat(
                  g.dateTimeLabelFormats[
                    (!g.grid && w.higherRanks[t]) || w.unitName
                  ],
                )),
                (I = F.main))
              : r(v) &&
                (I = k.dateTime.getXDateFormat(
                  v,
                  g.dateTimeLabelFormats || {},
                )));
          d.isFirst = e;
          d.isLast = b;
          const S = {
            axis: k,
            chart: m,
            dateTimeLabelFormat: I,
            isFirst: e,
            isLast: b,
            pos: t,
            tick: d,
            tickPositionInfo: w,
            value: v,
          };
          q(this, 'labelFormat', S);
          const P = (b) =>
            n.formatter
              ? n.formatter.call(b, b)
              : n.format
                ? ((b.text = k.defaultLabelFormatter.call(b, b)),
                  a.format(n.format, b, m))
                : k.defaultLabelFormatter.call(b, b);
          g = P.call(S, S);
          const O = F && F.list;
          d.shortenLabel = O
            ? function () {
                for (J = 0; J < O.length; J++)
                  if (
                    (u(S, { dateTimeLabelFormat: O[J] }),
                    l.attr({ text: P.call(S, S) }),
                    l.getBBox().width < k.getSlotWidth(d) - 2 * n.padding)
                  )
                    return;
                l.attr({ text: '' });
              }
            : void 0;
          c && k._addedPlotLB && d.moveLabel(g, n);
          D(l) || d.movedLabel
            ? l &&
              l.textStr !== g &&
              !c &&
              (!l.textWidth ||
                n.style.width ||
                l.styles.width ||
                l.css({ width: null }),
              l.attr({ text: g }),
              (l.textPxLength = l.getBBox().width))
            : ((d.label = l = d.createLabel({ x: 0, y: 0 }, g, n)),
              (d.rotation = 0));
        }
        createLabel(a, k, g) {
          const d = this.axis,
            h = d.chart;
          if (
            (a =
              D(k) && g.enabled
                ? h.renderer.text(k, a.x, a.y, g.useHTML).add(d.labelGroup)
                : null)
          )
            (h.styledMode || a.css(m(g.style)),
              (a.textPxLength = a.getBBox().width));
          return a;
        }
        destroy() {
          B(this, this.axis);
        }
        getPosition(a, k, g, h) {
          const d = this.axis,
            f = d.chart,
            p = (h && f.oldChartHeight) || f.chartHeight;
          a = {
            x: a
              ? z(d.translate(k + g, void 0, void 0, h) + d.transB)
              : d.left +
                d.offset +
                (d.opposite
                  ? ((h && f.oldChartWidth) || f.chartWidth) - d.right - d.left
                  : 0),
            y: a
              ? p - d.bottom + d.offset - (d.opposite ? d.height : 0)
              : z(p - d.translate(k + g, void 0, void 0, h) - d.transB),
          };
          a.y = C(a.y, -1e5, 1e5);
          q(this, 'afterGetPosition', { pos: a });
          return a;
        }
        getLabelPosition(a, k, g, m, v, f, p, t) {
          const d = this.axis,
            w = d.transA,
            e =
              d.isLinked && d.linkedParent
                ? d.linkedParent.reversed
                : d.reversed,
            b = d.staggerLines,
            c = d.tickRotCorr || { x: 0, y: 0 },
            l =
              m || d.reserveSpaceDefault
                ? 0
                : -d.labelOffset * ('center' === d.labelAlign ? 0.5 : 1),
            I = v.distance,
            F = {};
          g =
            0 === d.side
              ? g.rotation
                ? -I
                : -g.getBBox().height
              : 2 === d.side
                ? c.y + I
                : Math.cos(g.rotation * x) *
                  (c.y - g.getBBox(!1, 0).height / 2);
          D(v.y) && (g = 0 === d.side && d.horiz ? v.y + g : v.y);
          a =
            a +
            h(v.x, [0, 1, 0, -1][d.side] * I) +
            l +
            c.x -
            (f && m ? f * w * (e ? -1 : 1) : 0);
          k = k + g - (f && !m ? f * w * (e ? 1 : -1) : 0);
          b &&
            ((m = (p / (t || 1)) % b),
            d.opposite && (m = b - m - 1),
            (k += (d.labelOffset / b) * m));
          F.x = a;
          F.y = Math.round(k);
          q(this, 'afterGetLabelPosition', {
            pos: F,
            tickmarkOffset: f,
            index: p,
          });
          return F;
        }
        getLabelSize() {
          return this.label
            ? this.label.getBBox()[this.axis.horiz ? 'height' : 'width']
            : 0;
        }
        getMarkPath(a, k, g, h, m, f) {
          return f.crispLine(
            [
              ['M', a, k],
              ['L', a + (m ? 0 : -g), k + (m ? g : 0)],
            ],
            h,
          );
        }
        handleOverflow(a) {
          const d = this.axis,
            g = d.options.labels,
            m = a.x;
          var v = d.chart.chartWidth,
            f = d.chart.spacing;
          const p = h(d.labelLeft, Math.min(d.pos, f[3]));
          f = h(
            d.labelRight,
            Math.max(d.isRadial ? 0 : d.pos + d.len, v - f[1]),
          );
          const t = this.label,
            n = this.rotation,
            w = { left: 0, center: 0.5, right: 1 }[
              d.labelAlign || t.attr('align')
            ],
            e = t.getBBox().width,
            b = d.getSlotWidth(this),
            c = {};
          let l = b,
            I = 1,
            F;
          if (n || 'justify' !== g.overflow)
            0 > n && m - w * e < p
              ? (F = Math.round(m / Math.cos(n * x) - p))
              : 0 < n &&
                m + w * e > f &&
                (F = Math.round((v - m) / Math.cos(n * x)));
          else if (
            ((v = m + (1 - w) * e),
            m - w * e < p
              ? (l = a.x + l * (1 - w) - p)
              : v > f && ((l = f - a.x + l * w), (I = -1)),
            (l = Math.min(b, l)),
            l < b &&
              'center' === d.labelAlign &&
              (a.x += I * (b - l - w * (b - Math.min(e, l)))),
            e > l || (d.autoRotation && (t.styles || {}).width))
          )
            F = l;
          F &&
            (this.shortenLabel
              ? this.shortenLabel()
              : ((c.width = Math.floor(F) + 'px'),
                (g.style || {}).textOverflow || (c.textOverflow = 'ellipsis'),
                t.css(c)));
        }
        moveLabel(a, k) {
          const d = this;
          var g = d.label;
          const h = d.axis;
          let f = !1;
          g && g.textStr === a
            ? ((d.movedLabel = g), (f = !0), delete d.label)
            : v(h.ticks, function (p) {
                f ||
                  p.isNew ||
                  p === d ||
                  !p.label ||
                  p.label.textStr !== a ||
                  ((d.movedLabel = p.label),
                  (f = !0),
                  (p.labelPos = d.movedLabel.xy),
                  delete p.label);
              });
          f ||
            (!d.labelPos && !g) ||
            ((g = d.labelPos || g.xy),
            (d.movedLabel = d.createLabel(g, a, k)),
            d.movedLabel && d.movedLabel.attr({ opacity: 0 }));
        }
        render(a, k, g) {
          var d = this.axis,
            m = d.horiz,
            f = this.pos,
            p = h(this.tickmarkOffset, d.tickmarkOffset);
          f = this.getPosition(m, f, p, k);
          p = f.x;
          const t = f.y;
          d = (m && p === d.pos + d.len) || (!m && t === d.pos) ? -1 : 1;
          m = h(g, this.label && this.label.newOpacity, 1);
          g = h(g, 1);
          this.isActive = !0;
          this.renderGridLine(k, g, d);
          this.renderMark(f, g, d);
          this.renderLabel(f, k, m, a);
          this.isNew = !1;
          q(this, 'afterRender');
        }
        renderGridLine(a, g, m) {
          const d = this.axis,
            k = d.options,
            f = {},
            p = this.pos,
            t = this.type,
            n = h(this.tickmarkOffset, d.tickmarkOffset),
            w = d.chart.renderer;
          let e = this.gridLine,
            b = k.gridLineWidth,
            c = k.gridLineColor,
            l = k.gridLineDashStyle;
          'minor' === this.type &&
            ((b = k.minorGridLineWidth),
            (c = k.minorGridLineColor),
            (l = k.minorGridLineDashStyle));
          e ||
            (d.chart.styledMode ||
              ((f.stroke = c), (f['stroke-width'] = b || 0), (f.dashstyle = l)),
            t || (f.zIndex = 1),
            a && (g = 0),
            (this.gridLine = e =
              w
                .path()
                .attr(f)
                .addClass('highcharts-' + (t ? t + '-' : '') + 'grid-line')
                .add(d.gridGroup)));
          if (
            e &&
            (m = d.getPlotLinePath({
              value: p + n,
              lineWidth: e.strokeWidth() * m,
              force: 'pass',
              old: a,
              acrossPanes: !1,
            }))
          )
            e[a || this.isNew ? 'attr' : 'animate']({ d: m, opacity: g });
        }
        renderMark(a, g, m) {
          const d = this.axis;
          var k = d.options;
          const f = d.chart.renderer,
            p = this.type,
            t = d.tickSize(p ? p + 'Tick' : 'tick'),
            n = a.x;
          a = a.y;
          const w = h(
            k['minor' !== p ? 'tickWidth' : 'minorTickWidth'],
            !p && d.isXAxis ? 1 : 0,
          );
          k = k['minor' !== p ? 'tickColor' : 'minorTickColor'];
          let e = this.mark;
          const b = !e;
          t &&
            (d.opposite && (t[0] = -t[0]),
            e ||
              ((this.mark = e =
                f
                  .path()
                  .addClass('highcharts-' + (p ? p + '-' : '') + 'tick')
                  .add(d.axisGroup)),
              d.chart.styledMode || e.attr({ stroke: k, 'stroke-width': w })),
            e[b ? 'attr' : 'animate']({
              d: this.getMarkPath(n, a, t[0], e.strokeWidth() * m, d.horiz, f),
              opacity: g,
            }));
        }
        renderLabel(a, g, m, v) {
          var d = this.axis;
          const f = d.horiz,
            p = d.options,
            t = this.label,
            n = p.labels,
            w = n.step;
          d = h(this.tickmarkOffset, d.tickmarkOffset);
          const e = a.x;
          a = a.y;
          let b = !0;
          t &&
            r(e) &&
            ((t.xy = a = this.getLabelPosition(e, a, t, f, n, d, v, w)),
            (this.isFirst && !this.isLast && !p.showFirstLabel) ||
            (this.isLast && !this.isFirst && !p.showLastLabel)
              ? (b = !1)
              : !f ||
                n.step ||
                n.rotation ||
                g ||
                0 === m ||
                this.handleOverflow(a),
            w && v % w && (b = !1),
            b && r(a.y)
              ? ((a.opacity = m),
                t[this.isNewLabel ? 'attr' : 'animate'](a).show(!0),
                (this.isNewLabel = !1))
              : (t.hide(), (this.isNewLabel = !0)));
        }
        replaceMovedLabel() {
          const a = this.label,
            g = this.axis;
          a &&
            !this.isNew &&
            (a.animate({ opacity: 0 }, void 0, a.destroy), delete this.label);
          g.isDirty = !0;
          this.label = this.movedLabel;
          delete this.movedLabel;
        }
      }
      ('');
      return g;
    },
  );
  M(
    a,
    'Core/Axis/Axis.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Axis/AxisDefaults.js'],
      a['Core/Color/Color.js'],
      a['Core/Defaults.js'],
      a['Core/Foundation.js'],
      a['Core/Globals.js'],
      a['Core/Axis/Tick.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D, B) {
      const { animObject: u } = a,
        { defaultOptions: q } = H,
        { registerEventOptions: r } = C,
        { deg2rad: m } = z,
        {
          arrayMax: v,
          arrayMin: h,
          clamp: g,
          correctFloat: d,
          defined: k,
          destroyObjectProperties: y,
          erase: K,
          error: L,
          extend: f,
          fireEvent: p,
          getClosestDistance: t,
          insertItem: n,
          isArray: w,
          isNumber: e,
          isString: b,
          merge: c,
          normalizeTickInterval: l,
          objectEach: I,
          pick: F,
          relativeLength: J,
          removeEvent: S,
          splat: P,
          syncTimeout: O,
        } = B,
        Q = (b, c) =>
          l(
            c,
            void 0,
            void 0,
            F(b.options.allowDecimals, 0.5 > c || void 0 !== b.tickAmount),
            !!b.tickAmount,
          );
      class W {
        constructor(b, c, e) {
          this.zoomEnabled =
            this.width =
            this.visible =
            this.userOptions =
            this.translationSlope =
            this.transB =
            this.transA =
            this.top =
            this.ticks =
            this.tickRotCorr =
            this.tickPositions =
            this.tickmarkOffset =
            this.tickInterval =
            this.tickAmount =
            this.side =
            this.series =
            this.right =
            this.positiveValuesOnly =
            this.pos =
            this.pointRangePadding =
            this.pointRange =
            this.plotLinesAndBandsGroups =
            this.plotLinesAndBands =
            this.paddedTicks =
            this.overlap =
            this.options =
            this.offset =
            this.names =
            this.minPixelPadding =
            this.minorTicks =
            this.minorTickInterval =
            this.min =
            this.maxLabelLength =
            this.max =
            this.len =
            this.left =
            this.labelFormatter =
            this.labelEdge =
            this.isLinked =
            this.index =
            this.height =
            this.hasVisibleSeries =
            this.hasNames =
            this.eventOptions =
            this.coll =
            this.closestPointRange =
            this.chart =
            this.bottom =
            this.alternateBands =
              void 0;
          this.init(b, c, e);
        }
        init(b, c, l = this.coll) {
          const f = 'xAxis' === l;
          this.chart = b;
          this.horiz = this.isZAxis || (b.inverted ? !f : f);
          this.isXAxis = f;
          this.coll = l;
          p(this, 'init', { userOptions: c });
          this.opposite = F(c.opposite, this.opposite);
          this.side = F(
            c.side,
            this.side,
            this.horiz ? (this.opposite ? 0 : 2) : this.opposite ? 1 : 3,
          );
          this.setOptions(c);
          l = this.options;
          const a = l.labels,
            d = l.type;
          this.userOptions = c;
          this.minPixelPadding = 0;
          this.reversed = F(l.reversed, this.reversed);
          this.visible = l.visible;
          this.zoomEnabled = l.zoomEnabled;
          this.hasNames = 'category' === d || !0 === l.categories;
          this.categories = l.categories || (this.hasNames ? [] : void 0);
          this.names || ((this.names = []), (this.names.keys = {}));
          this.plotLinesAndBandsGroups = {};
          this.positiveValuesOnly = !!this.logarithmic;
          this.isLinked = k(l.linkedTo);
          this.ticks = {};
          this.labelEdge = [];
          this.minorTicks = {};
          this.plotLinesAndBands = [];
          this.alternateBands = {};
          this.len = 0;
          this.minRange = this.userMinRange = l.minRange || l.maxZoom;
          this.range = l.range;
          this.offset = l.offset || 0;
          this.min = this.max = null;
          c = F(l.crosshair, P(b.options.tooltip.crosshairs)[f ? 0 : 1]);
          this.crosshair = !0 === c ? {} : c;
          -1 === b.axes.indexOf(this) &&
            (f ? b.axes.splice(b.xAxis.length, 0, this) : b.axes.push(this),
            n(this, b[this.coll]));
          b.orderItems(this.coll);
          this.series = this.series || [];
          b.inverted &&
            !this.isZAxis &&
            f &&
            'undefined' === typeof this.reversed &&
            (this.reversed = !0);
          this.labelRotation = e(a.rotation) ? a.rotation : void 0;
          r(this, l);
          p(this, 'afterInit');
        }
        setOptions(b) {
          this.options = c(
            A.defaultXAxisOptions,
            'yAxis' === this.coll && A.defaultYAxisOptions,
            [
              A.defaultTopAxisOptions,
              A.defaultRightAxisOptions,
              A.defaultBottomAxisOptions,
              A.defaultLeftAxisOptions,
            ][this.side],
            c(q[this.coll], b),
          );
          p(this, 'afterSetOptions', { userOptions: b });
        }
        defaultLabelFormatter(b) {
          var c = this.axis;
          ({ numberFormatter: b } = this.chart);
          const l = e(this.value) ? this.value : NaN,
            f = c.chart.time,
            a = this.dateTimeLabelFormat;
          var d = q.lang;
          const n = d.numericSymbols;
          d = d.numericSymbolMagnitude || 1e3;
          const E = c.logarithmic ? Math.abs(l) : c.tickInterval;
          let p = n && n.length,
            t;
          if (c.categories) t = `${this.value}`;
          else if (a) t = f.dateFormat(a, l);
          else if (p && 1e3 <= E)
            for (; p-- && 'undefined' === typeof t; )
              ((c = Math.pow(d, p + 1)),
                E >= c &&
                  0 === (10 * l) % c &&
                  null !== n[p] &&
                  0 !== l &&
                  (t = b(l / c, -1) + n[p]));
          'undefined' === typeof t &&
            (t = 1e4 <= Math.abs(l) ? b(l, -1) : b(l, -1, void 0, ''));
          return t;
        }
        getSeriesExtremes() {
          const b = this,
            c = b.chart;
          let l;
          p(this, 'getSeriesExtremes', null, function () {
            b.hasVisibleSeries = !1;
            b.dataMin = b.dataMax = b.threshold = null;
            b.softThreshold = !b.isXAxis;
            b.series.forEach(function (f) {
              if (f.visible || !c.options.chart.ignoreHiddenSeries) {
                var a = f.options;
                let c = a.threshold,
                  d,
                  n;
                b.hasVisibleSeries = !0;
                b.positiveValuesOnly && 0 >= c && (c = null);
                if (b.isXAxis)
                  (a = f.xData) &&
                    a.length &&
                    ((a = b.logarithmic ? a.filter((b) => 0 < b) : a),
                    (l = f.getXExtremes(a)),
                    (d = l.min),
                    (n = l.max),
                    e(d) ||
                      d instanceof Date ||
                      ((a = a.filter(e)),
                      (l = f.getXExtremes(a)),
                      (d = l.min),
                      (n = l.max)),
                    a.length &&
                      ((b.dataMin = Math.min(F(b.dataMin, d), d)),
                      (b.dataMax = Math.max(F(b.dataMax, n), n))));
                else if (
                  ((f = f.applyExtremes()),
                  e(f.dataMin) &&
                    ((d = f.dataMin),
                    (b.dataMin = Math.min(F(b.dataMin, d), d))),
                  e(f.dataMax) &&
                    ((n = f.dataMax),
                    (b.dataMax = Math.max(F(b.dataMax, n), n))),
                  k(c) && (b.threshold = c),
                  !a.softThreshold || b.positiveValuesOnly)
                )
                  b.softThreshold = !1;
              }
            });
          });
          p(this, 'afterGetSeriesExtremes');
        }
        translate(b, c, l, f, a, n) {
          const p = this.linkedParent || this,
            E = f && p.old ? p.old.min : p.min;
          if (!e(E)) return NaN;
          const t = p.minPixelPadding;
          a =
            (p.isOrdinal ||
              (p.brokenAxis && p.brokenAxis.hasBreaks) ||
              (p.logarithmic && a)) &&
            p.lin2val;
          let w = 1,
            g = 0;
          f = f && p.old ? p.old.transA : p.transA;
          f || (f = p.transA);
          l && ((w *= -1), (g = p.len));
          p.reversed && ((w *= -1), (g -= w * (p.sector || p.len)));
          c
            ? ((n = (b * w + g - t) / f + E), a && (n = p.lin2val(n)))
            : (a && (b = p.val2lin(b)),
              (b = w * (b - E) * f),
              (n = (p.isRadial ? b : d(b)) + g + w * t + (e(n) ? f * n : 0)));
          return n;
        }
        toPixels(b, c) {
          return (
            this.translate(b, !1, !this.horiz, void 0, !0) + (c ? 0 : this.pos)
          );
        }
        toValue(b, c) {
          return this.translate(
            b - (c ? 0 : this.pos),
            !0,
            !this.horiz,
            void 0,
            !0,
          );
        }
        getPlotLinePath(b) {
          function c(b, c, e) {
            'pass' !== m &&
              (b < c || b > e) &&
              (m ? (b = g(b, c, e)) : (y = !0));
            return b;
          }
          const l = this,
            f = l.chart,
            a = l.left,
            d = l.top,
            n = b.old,
            E = b.value,
            t = b.lineWidth,
            w = (n && f.oldChartHeight) || f.chartHeight,
            k = (n && f.oldChartWidth) || f.chartWidth,
            h = l.transB;
          let I = b.translatedValue,
            m = b.force,
            J,
            v,
            q,
            r,
            y;
          b = {
            value: E,
            lineWidth: t,
            old: n,
            force: m,
            acrossPanes: b.acrossPanes,
            translatedValue: I,
          };
          p(this, 'getPlotLinePath', b, function (b) {
            I = F(I, l.translate(E, void 0, void 0, n));
            I = g(I, -1e5, 1e5);
            J = q = Math.round(I + h);
            v = r = Math.round(w - I - h);
            e(I)
              ? l.horiz
                ? ((v = d), (r = w - l.bottom), (J = q = c(J, a, a + l.width)))
                : ((J = a), (q = k - l.right), (v = r = c(v, d, d + l.height)))
              : ((y = !0), (m = !1));
            b.path =
              y && !m
                ? null
                : f.renderer.crispLine(
                    [
                      ['M', J, v],
                      ['L', q, r],
                    ],
                    t || 1,
                  );
          });
          return b.path;
        }
        getLinearTickPositions(b, c, e) {
          const l = d(Math.floor(c / b) * b);
          e = d(Math.ceil(e / b) * b);
          const f = [];
          let a, n;
          d(l + b) === l && (n = 20);
          if (this.single) return [c];
          for (c = l; c <= e; ) {
            f.push(c);
            c = d(c + b, n);
            if (c === a) break;
            a = c;
          }
          return f;
        }
        getMinorTickInterval() {
          const b = this.options;
          return !0 === b.minorTicks
            ? F(b.minorTickInterval, 'auto')
            : !1 === b.minorTicks
              ? null
              : b.minorTickInterval;
        }
        getMinorTickPositions() {
          var b = this.options;
          const c = this.tickPositions,
            e = this.minorTickInterval;
          var l = this.pointRangePadding || 0;
          const f = this.min - l;
          l = this.max + l;
          const a = l - f;
          let d = [];
          if (a && a / e < this.len / 3) {
            const a = this.logarithmic;
            if (a)
              this.paddedTicks.forEach(function (b, c, l) {
                c &&
                  d.push.apply(d, a.getLogTickPositions(e, l[c - 1], l[c], !0));
              });
            else if (this.dateTime && 'auto' === this.getMinorTickInterval())
              d = d.concat(
                this.getTimeTicks(
                  this.dateTime.normalizeTimeTickInterval(e),
                  f,
                  l,
                  b.startOfWeek,
                ),
              );
            else
              for (b = f + ((c[0] - f) % e); b <= l && b !== d[0]; b += e)
                d.push(b);
          }
          0 !== d.length && this.trimTicks(d);
          return d;
        }
        adjustForMinRange() {
          const b = this.options,
            c = this.logarithmic;
          let e = this.min;
          var l = this.max;
          let f, a;
          if (this.isXAxis && 'undefined' === typeof this.minRange && !c)
            if (k(b.min) || k(b.max) || k(b.floor) || k(b.ceiling))
              this.minRange = null;
            else {
              var d =
                t(
                  this.series.map((b) => {
                    var c;
                    return (
                      (b.xIncrement
                        ? null === (c = b.xData) || void 0 === c
                          ? void 0
                          : c.slice(0, 2)
                        : b.xData) || []
                    );
                  }),
                ) || 0;
              this.minRange = Math.min(5 * d, this.dataMax - this.dataMin);
            }
          l - e < this.minRange &&
            ((d = this.dataMax - this.dataMin >= this.minRange),
            (a = this.minRange),
            (l = (a - l + e) / 2),
            (f = [e - l, F(b.min, e - l)]),
            d && (f[2] = c ? c.log2lin(this.dataMin) : this.dataMin),
            (e = v(f)),
            (l = [e + a, F(b.max, e + a)]),
            d && (l[2] = c ? c.log2lin(this.dataMax) : this.dataMax),
            (l = h(l)),
            l - e < a &&
              ((f[0] = l - a), (f[1] = F(b.min, l - a)), (e = v(f))));
          this.min = e;
          this.max = l;
        }
        getClosest() {
          let b, c;
          if (this.categories) c = 1;
          else {
            const e = [];
            this.series.forEach(function (b) {
              var l;
              const f = b.closestPointRange,
                a = b.visible || !b.chart.options.chart.ignoreHiddenSeries;
              1 === (null === (l = b.xData) || void 0 === l ? void 0 : l.length)
                ? e.push(b.xData[0])
                : !b.noSharedTooltip &&
                  k(f) &&
                  a &&
                  (c = k(c) ? Math.min(c, f) : f);
            });
            e.length && (e.sort((b, c) => b - c), (b = t([e])));
          }
          return b && c ? Math.min(b, c) : b || c;
        }
        nameToX(b) {
          const c = w(this.options.categories),
            e = c ? this.categories : this.names;
          let l = b.options.x,
            f;
          b.series.requireSorting = !1;
          k(l) ||
            (l =
              this.options.uniqueNames && e
                ? c
                  ? e.indexOf(b.name)
                  : F(e.keys[b.name], -1)
                : b.series.autoIncrement());
          -1 === l ? !c && e && (f = e.length) : (f = l);
          'undefined' !== typeof f
            ? ((this.names[f] = b.name), (this.names.keys[b.name] = f))
            : b.x && (f = b.x);
          return f;
        }
        updateNames() {
          const b = this,
            c = this.names;
          0 < c.length &&
            (Object.keys(c.keys).forEach(function (b) {
              delete c.keys[b];
            }),
            (c.length = 0),
            (this.minRange = this.userMinRange),
            (this.series || []).forEach(function (c) {
              c.xIncrement = null;
              if (!c.points || c.isDirtyData)
                ((b.max = Math.max(b.max, c.xData.length - 1)),
                  c.processData(),
                  c.generatePoints());
              c.data.forEach(function (e, l) {
                let f;
                e &&
                  e.options &&
                  'undefined' !== typeof e.name &&
                  ((f = b.nameToX(e)),
                  'undefined' !== typeof f &&
                    f !== e.x &&
                    ((e.x = f), (c.xData[l] = f)));
              });
            }));
        }
        setAxisTranslation() {
          const c = this,
            e = c.max - c.min;
          var l = c.linkedParent;
          const f = !!c.categories,
            a = c.isXAxis;
          let d = c.axisPointRange || 0,
            n,
            t = 0,
            w = 0,
            g = c.transA;
          if (a || f || d)
            ((n = c.getClosest()),
              l
                ? ((t = l.minPointOffset), (w = l.pointRangePadding))
                : c.series.forEach(function (e) {
                    const l = f
                        ? 1
                        : a
                          ? F(e.options.pointRange, n, 0)
                          : c.axisPointRange || 0,
                      p = e.options.pointPlacement;
                    d = Math.max(d, l);
                    if (!c.single || f)
                      ((e = e.is('xrange') ? !a : a),
                        (t = Math.max(t, e && b(p) ? 0 : l / 2)),
                        (w = Math.max(w, e && 'on' === p ? 0 : l)));
                  }),
              (l = c.ordinal && c.ordinal.slope && n ? c.ordinal.slope / n : 1),
              (c.minPointOffset = t *= l),
              (c.pointRangePadding = w *= l),
              (c.pointRange = Math.min(d, c.single && f ? 1 : e)),
              a && n && (c.closestPointRange = n));
          c.translationSlope =
            c.transA =
            g =
              c.staticScale || c.len / (e + w || 1);
          c.transB = c.horiz ? c.left : c.bottom;
          c.minPixelPadding = g * t;
          p(this, 'afterSetAxisTranslation');
        }
        minFromRange() {
          return this.max - this.range;
        }
        setTickInterval(b) {
          var c = this.chart;
          const l = this.logarithmic,
            f = this.options,
            a = this.isXAxis,
            n = this.isLinked,
            t = f.tickPixelInterval,
            w = this.categories,
            E = this.softThreshold;
          let g = f.maxPadding,
            I = f.minPadding;
          let h =
              e(f.tickInterval) && 0 <= f.tickInterval
                ? f.tickInterval
                : void 0,
            m = e(this.threshold) ? this.threshold : null,
            J,
            v,
            q;
          this.dateTime || w || n || this.getTickAmount();
          v = F(this.userMin, f.min);
          q = F(this.userMax, f.max);
          if (n) {
            this.linkedParent = c[this.coll][f.linkedTo];
            var r = this.linkedParent.getExtremes();
            this.min = F(r.min, r.dataMin);
            this.max = F(r.max, r.dataMax);
            f.type !== this.linkedParent.options.type && L(11, 1, c);
          } else
            (E &&
              k(m) &&
              (this.dataMin >= m
                ? ((r = m), (I = 0))
                : this.dataMax <= m && ((J = m), (g = 0))),
              (this.min = F(v, r, this.dataMin)),
              (this.max = F(q, J, this.dataMax)));
          l &&
            (this.positiveValuesOnly &&
              !b &&
              0 >= Math.min(this.min, F(this.dataMin, this.min)) &&
              L(10, 1, c),
            (this.min = d(l.log2lin(this.min), 16)),
            (this.max = d(l.log2lin(this.max), 16)));
          this.range &&
            k(this.max) &&
            ((this.userMin =
              this.min =
              v =
                Math.max(this.dataMin, this.minFromRange())),
            (this.userMax = q = this.max),
            (this.range = null));
          p(this, 'foundExtremes');
          this.beforePadding && this.beforePadding();
          this.adjustForMinRange();
          !e(this.userMin) &&
            e(f.softMin) &&
            f.softMin < this.min &&
            (this.min = v = f.softMin);
          !e(this.userMax) &&
            e(f.softMax) &&
            f.softMax > this.max &&
            (this.max = q = f.softMax);
          !(
            w ||
            this.axisPointRange ||
            (this.stacking && this.stacking.usePercentage) ||
            n
          ) &&
            k(this.min) &&
            k(this.max) &&
            (c = this.max - this.min) &&
            (!k(v) && I && (this.min -= c * I),
            !k(q) && g && (this.max += c * g));
          !e(this.userMin) &&
            e(f.floor) &&
            (this.min = Math.max(this.min, f.floor));
          !e(this.userMax) &&
            e(f.ceiling) &&
            (this.max = Math.min(this.max, f.ceiling));
          E &&
            k(this.dataMin) &&
            ((m = m || 0),
            !k(v) && this.min < m && this.dataMin >= m
              ? (this.min = this.options.minRange
                  ? Math.min(m, this.max - this.minRange)
                  : m)
              : !k(q) &&
                this.max > m &&
                this.dataMax <= m &&
                (this.max = this.options.minRange
                  ? Math.max(m, this.min + this.minRange)
                  : m));
          e(this.min) &&
            e(this.max) &&
            !this.chart.polar &&
            this.min > this.max &&
            (k(this.options.min)
              ? (this.max = this.min)
              : k(this.options.max) && (this.min = this.max));
          this.tickInterval =
            this.min === this.max ||
            'undefined' === typeof this.min ||
            'undefined' === typeof this.max
              ? 1
              : n &&
                  this.linkedParent &&
                  !h &&
                  t === this.linkedParent.options.tickPixelInterval
                ? (h = this.linkedParent.tickInterval)
                : F(
                    h,
                    this.tickAmount
                      ? (this.max - this.min) / Math.max(this.tickAmount - 1, 1)
                      : void 0,
                    w ? 1 : ((this.max - this.min) * t) / Math.max(this.len, t),
                  );
          if (a && !b) {
            const b =
              this.min !== (this.old && this.old.min) ||
              this.max !== (this.old && this.old.max);
            this.series.forEach(function (c) {
              c.forceCrop = c.forceCropping && c.forceCropping();
              c.processData(b);
            });
            p(this, 'postProcessData', { hasExtremesChanged: b });
          }
          this.setAxisTranslation();
          p(this, 'initialAxisTranslation');
          this.pointRange &&
            !h &&
            (this.tickInterval = Math.max(this.pointRange, this.tickInterval));
          b = F(
            f.minTickInterval,
            this.dateTime && !this.series.some((b) => b.noSharedTooltip)
              ? this.closestPointRange
              : 0,
          );
          !h && this.tickInterval < b && (this.tickInterval = b);
          this.dateTime ||
            this.logarithmic ||
            h ||
            (this.tickInterval = Q(this, this.tickInterval));
          this.tickAmount || (this.tickInterval = this.unsquish());
          this.setTickPositions();
        }
        setTickPositions() {
          var b = this.options;
          const c = b.tickPositions,
            l = b.tickPositioner;
          var f = this.getMinorTickInterval(),
            a = this.hasVerticalPanning(),
            d = 'colorAxis' === this.coll;
          const n = (d || !a) && b.startOnTick;
          a = (d || !a) && b.endOnTick;
          d = [];
          let t;
          this.tickmarkOffset =
            this.categories &&
            'between' === b.tickmarkPlacement &&
            1 === this.tickInterval
              ? 0.5
              : 0;
          this.minorTickInterval =
            'auto' === f && this.tickInterval
              ? this.tickInterval / b.minorTicksPerMajor
              : f;
          this.single =
            this.min === this.max &&
            k(this.min) &&
            !this.tickAmount &&
            (parseInt(this.min, 10) === this.min || !1 !== b.allowDecimals);
          if (c) d = c.slice();
          else if (e(this.min) && e(this.max)) {
            if (
              (this.ordinal && this.ordinal.positions) ||
              !(
                (this.max - this.min) / this.tickInterval >
                Math.max(2 * this.len, 200)
              )
            )
              if (this.dateTime)
                d = this.getTimeTicks(
                  this.dateTime.normalizeTimeTickInterval(
                    this.tickInterval,
                    b.units,
                  ),
                  this.min,
                  this.max,
                  b.startOfWeek,
                  this.ordinal && this.ordinal.positions,
                  this.closestPointRange,
                  !0,
                );
              else if (this.logarithmic)
                d = this.logarithmic.getLogTickPositions(
                  this.tickInterval,
                  this.min,
                  this.max,
                );
              else
                for (f = b = this.tickInterval; f <= 2 * b; )
                  if (
                    ((d = this.getLinearTickPositions(
                      this.tickInterval,
                      this.min,
                      this.max,
                    )),
                    this.tickAmount && d.length > this.tickAmount)
                  )
                    this.tickInterval = Q(this, (f *= 1.1));
                  else break;
            else ((d = [this.min, this.max]), L(19, !1, this.chart));
            d.length > this.len &&
              ((d = [d[0], d[d.length - 1]]), d[0] === d[1] && (d.length = 1));
            l &&
              ((this.tickPositions = d),
              (t = l.apply(this, [this.min, this.max])) && (d = t));
          }
          this.tickPositions = d;
          this.paddedTicks = d.slice(0);
          this.trimTicks(d, n, a);
          !this.isLinked &&
            e(this.min) &&
            e(this.max) &&
            (this.single &&
              2 > d.length &&
              !this.categories &&
              !this.series.some(
                (b) =>
                  b.is('heatmap') && 'between' === b.options.pointPlacement,
              ) &&
              ((this.min -= 0.5), (this.max += 0.5)),
            c || t || this.adjustTickAmount());
          p(this, 'afterSetTickPositions');
        }
        trimTicks(b, c, e) {
          const l = b[0],
            f = b[b.length - 1],
            a = (!this.isOrdinal && this.minPointOffset) || 0;
          p(this, 'trimTicks');
          if (!this.isLinked) {
            if (c && -Infinity !== l) this.min = l;
            else for (; this.min - a > b[0]; ) b.shift();
            if (e) this.max = f;
            else for (; this.max + a < b[b.length - 1]; ) b.pop();
            0 === b.length &&
              k(l) &&
              !this.options.tickPositions &&
              b.push((f + l) / 2);
          }
        }
        alignToOthers() {
          const b = this,
            c = [this],
            l = b.options,
            f =
              'yAxis' === this.coll && this.chart.options.chart.alignThresholds,
            a = [];
          let d;
          b.thresholdAlignment = void 0;
          if (
            ((!1 !== this.chart.options.chart.alignTicks && l.alignTicks) ||
              f) &&
            !1 !== l.startOnTick &&
            !1 !== l.endOnTick &&
            !b.logarithmic
          ) {
            const e = (b) => {
                const { horiz: c, options: e } = b;
                return [c ? e.left : e.top, e.width, e.height, e.pane].join();
              },
              l = e(this);
            this.chart[this.coll].forEach(function (f) {
              const { series: a } = f;
              a.length &&
                a.some((b) => b.visible) &&
                f !== b &&
                e(f) === l &&
                ((d = !0), c.push(f));
            });
          }
          if (d && f) {
            c.forEach((c) => {
              c = c.getThresholdAlignment(b);
              e(c) && a.push(c);
            });
            const l =
              1 < a.length ? a.reduce((b, c) => b + c, 0) / a.length : void 0;
            c.forEach((b) => {
              b.thresholdAlignment = l;
            });
          }
          return d;
        }
        getThresholdAlignment(b) {
          (!e(this.dataMin) ||
            (this !== b &&
              this.series.some((b) => b.isDirty || b.isDirtyData))) &&
            this.getSeriesExtremes();
          if (e(this.threshold))
            return (
              (b = g(
                (this.threshold - (this.dataMin || 0)) /
                  ((this.dataMax || 0) - (this.dataMin || 0)),
                0,
                1,
              )),
              this.options.reversed && (b = 1 - b),
              b
            );
        }
        getTickAmount() {
          const b = this.options,
            c = b.tickPixelInterval;
          let e = b.tickAmount;
          !k(b.tickInterval) &&
            !e &&
            this.len < c &&
            !this.isRadial &&
            !this.logarithmic &&
            b.startOnTick &&
            b.endOnTick &&
            (e = 2);
          !e && this.alignToOthers() && (e = Math.ceil(this.len / c) + 1);
          4 > e && ((this.finalTickAmt = e), (e = 5));
          this.tickAmount = e;
        }
        adjustTickAmount() {
          const b = this,
            {
              finalTickAmt: c,
              max: l,
              min: f,
              options: a,
              tickPositions: n,
              tickAmount: p,
              thresholdAlignment: t,
            } = b,
            w = n && n.length;
          var g = F(b.threshold, b.softThreshold ? 0 : null);
          var I = b.tickInterval;
          let h;
          e(t) &&
            ((h = 0.5 > t ? Math.ceil(t * (p - 1)) : Math.floor(t * (p - 1))),
            a.reversed && (h = p - 1 - h));
          if (b.hasData() && e(f) && e(l)) {
            const t = () => {
              b.transA *= (w - 1) / (p - 1);
              b.min = a.startOnTick ? n[0] : Math.min(f, n[0]);
              b.max = a.endOnTick
                ? n[n.length - 1]
                : Math.max(l, n[n.length - 1]);
            };
            if (e(h) && e(b.threshold)) {
              for (
                ;
                n[h] !== g || n.length !== p || n[0] > f || n[n.length - 1] < l;
              ) {
                n.length = 0;
                for (n.push(b.threshold); n.length < p; )
                  void 0 === n[h] || n[h] > b.threshold
                    ? n.unshift(d(n[0] - I))
                    : n.push(d(n[n.length - 1] + I));
                if (I > 8 * b.tickInterval) break;
                I *= 2;
              }
              t();
            } else if (w < p) {
              for (; n.length < p; )
                n.length % 2 || f === g
                  ? n.push(d(n[n.length - 1] + I))
                  : n.unshift(d(n[0] - I));
              t();
            }
            if (k(c)) {
              for (I = g = n.length; I--; )
                ((3 === c && 1 === I % 2) || (2 >= c && 0 < I && I < g - 1)) &&
                  n.splice(I, 1);
              b.finalTickAmt = void 0;
            }
          }
        }
        setScale() {
          let b = !1,
            c = !1;
          this.series.forEach(function (e) {
            b = b || e.isDirtyData || e.isDirty;
            c = c || (e.xAxis && e.xAxis.isDirty) || !1;
          });
          this.setAxisSize();
          const e = this.len !== (this.old && this.old.len);
          e ||
          b ||
          c ||
          this.isLinked ||
          this.forceRedraw ||
          this.userMin !== (this.old && this.old.userMin) ||
          this.userMax !== (this.old && this.old.userMax) ||
          this.alignToOthers()
            ? (this.stacking &&
                (this.stacking.resetStacks(), this.stacking.buildStacks()),
              (this.forceRedraw = !1),
              this.userMinRange || (this.minRange = void 0),
              this.getSeriesExtremes(),
              this.setTickInterval(),
              this.isDirty ||
                (this.isDirty =
                  e ||
                  this.min !== (this.old && this.old.min) ||
                  this.max !== (this.old && this.old.max)))
            : this.stacking && this.stacking.cleanStacks();
          b && this.panningState && (this.panningState.isDirty = !0);
          p(this, 'afterSetScale');
        }
        setExtremes(b, c, e, l, a) {
          const d = this,
            n = d.chart;
          e = F(e, !0);
          d.series.forEach(function (b) {
            delete b.kdTree;
          });
          a = f(a, { min: b, max: c });
          p(d, 'setExtremes', a, function () {
            d.userMin = b;
            d.userMax = c;
            d.eventArgs = a;
            e && n.redraw(l);
          });
        }
        zoom(b, c) {
          const e = this,
            l = this.dataMin,
            f = this.dataMax,
            a = this.options,
            d = Math.min(l, F(a.min, l)),
            n = Math.max(f, F(a.max, f));
          b = { newMin: b, newMax: c };
          p(this, 'zoom', b, function (b) {
            let c = b.newMin,
              a = b.newMax;
            if (c !== e.min || a !== e.max)
              (e.allowZoomOutside ||
                (k(l) && (c < d && (c = d), c > n && (c = n)),
                k(f) && (a < d && (a = d), a > n && (a = n))),
                (e.displayBtn =
                  'undefined' !== typeof c || 'undefined' !== typeof a),
                e.setExtremes(c, a, !1, void 0, { trigger: 'zoom' }));
            b.zoomed = !0;
          });
          return b.zoomed;
        }
        setAxisSize() {
          const b = this.chart;
          var c = this.options;
          const e = c.offsets || [0, 0, 0, 0],
            l = this.horiz,
            f = (this.width = Math.round(
              J(F(c.width, b.plotWidth - e[3] + e[1]), b.plotWidth),
            )),
            a = (this.height = Math.round(
              J(F(c.height, b.plotHeight - e[0] + e[2]), b.plotHeight),
            )),
            d = (this.top = Math.round(
              J(F(c.top, b.plotTop + e[0]), b.plotHeight, b.plotTop),
            ));
          c = this.left = Math.round(
            J(F(c.left, b.plotLeft + e[3]), b.plotWidth, b.plotLeft),
          );
          this.bottom = b.chartHeight - a - d;
          this.right = b.chartWidth - f - c;
          this.len = Math.max(l ? f : a, 0);
          this.pos = l ? c : d;
        }
        getExtremes() {
          const b = this.logarithmic;
          return {
            min: b ? d(b.lin2log(this.min)) : this.min,
            max: b ? d(b.lin2log(this.max)) : this.max,
            dataMin: this.dataMin,
            dataMax: this.dataMax,
            userMin: this.userMin,
            userMax: this.userMax,
          };
        }
        getThreshold(b) {
          var c = this.logarithmic;
          const e = c ? c.lin2log(this.min) : this.min;
          c = c ? c.lin2log(this.max) : this.max;
          null === b || -Infinity === b
            ? (b = e)
            : Infinity === b
              ? (b = c)
              : e > b
                ? (b = e)
                : c < b && (b = c);
          return this.translate(b, 0, 1, 0, 1);
        }
        autoLabelAlign(b) {
          const c = (F(b, 0) - 90 * this.side + 720) % 360;
          b = { align: 'center' };
          p(this, 'autoLabelAlign', b, function (b) {
            15 < c && 165 > c
              ? (b.align = 'right')
              : 195 < c && 345 > c && (b.align = 'left');
          });
          return b.align;
        }
        tickSize(b) {
          const c = this.options,
            e = F(
              c['tick' === b ? 'tickWidth' : 'minorTickWidth'],
              'tick' === b && this.isXAxis && !this.categories ? 1 : 0,
            );
          let l = c['tick' === b ? 'tickLength' : 'minorTickLength'],
            f;
          e && l && ('inside' === c[b + 'Position'] && (l = -l), (f = [l, e]));
          b = { tickSize: f };
          p(this, 'afterTickSize', b);
          return b.tickSize;
        }
        labelMetrics() {
          const b = this.chart.renderer;
          var c = this.ticks;
          c = c[Object.keys(c)[0]] || {};
          return this.chart.renderer.fontMetrics(
            c.label || c.movedLabel || b.box,
          );
        }
        unsquish() {
          const b = this.options.labels;
          var c = this.horiz;
          const l = this.tickInterval,
            f =
              this.len /
              (((this.categories ? 1 : 0) + this.max - this.min) / l),
            a = b.rotation,
            n = 0.75 * this.labelMetrics().h,
            p = Math.max(this.max - this.min, 0),
            t = function (b) {
              let c = b / (f || 1);
              c = 1 < c ? Math.ceil(c) : 1;
              c * l > p &&
                Infinity !== b &&
                Infinity !== f &&
                p &&
                (c = Math.ceil(p / l));
              return d(c * l);
            };
          let w = l,
            g,
            k = Number.MAX_VALUE,
            I;
          if (c) {
            if (
              (b.staggerLines ||
                (e(a)
                  ? (I = [a])
                  : f < b.autoRotationLimit && (I = b.autoRotation)),
              I)
            ) {
              let b;
              for (const e of I)
                if (e === a || (e && -90 <= e && 90 >= e))
                  ((c = t(Math.abs(n / Math.sin(m * e)))),
                    (b = c + Math.abs(e / 360)),
                    b < k && ((k = b), (g = e), (w = c)));
            }
          } else w = t(n);
          this.autoRotation = I;
          this.labelRotation = F(g, e(a) ? a : 0);
          return b.step ? l : w;
        }
        getSlotWidth(b) {
          const c = this.chart,
            l = this.horiz,
            f = this.options.labels,
            a = Math.max(
              this.tickPositions.length - (this.categories ? 0 : 1),
              1,
            ),
            d = c.margin[3];
          if (b && e(b.slotWidth)) return b.slotWidth;
          if (l && 2 > f.step)
            return f.rotation ? 0 : ((this.staggerLines || 1) * this.len) / a;
          if (!l) {
            b = f.style.width;
            if (void 0 !== b) return parseInt(String(b), 10);
            if (d) return d - c.spacing[3];
          }
          return 0.33 * c.chartWidth;
        }
        renderUnsquish() {
          const c = this.chart,
            e = c.renderer,
            l = this.tickPositions,
            f = this.ticks,
            a = this.options.labels,
            d = a.style,
            n = this.horiz,
            p = this.getSlotWidth();
          var t = Math.max(1, Math.round(p - 2 * a.padding));
          const w = {},
            g = this.labelMetrics(),
            k = d.textOverflow;
          let I,
            h,
            F = 0;
          b(a.rotation) || (w.rotation = a.rotation || 0);
          l.forEach(function (b) {
            b = f[b];
            b.movedLabel && b.replaceMovedLabel();
            b &&
              b.label &&
              b.label.textPxLength > F &&
              (F = b.label.textPxLength);
          });
          this.maxLabelLength = F;
          if (this.autoRotation)
            F > t && F > g.h
              ? (w.rotation = this.labelRotation)
              : (this.labelRotation = 0);
          else if (p && ((I = t), !k))
            for (h = 'clip', t = l.length; !n && t--; ) {
              var m = l[t];
              if ((m = f[m].label))
                (m.styles && 'ellipsis' === m.styles.textOverflow
                  ? m.css({ textOverflow: 'clip' })
                  : m.textPxLength > p && m.css({ width: p + 'px' }),
                  m.getBBox().height > this.len / l.length - (g.h - g.f) &&
                    (m.specificTextOverflow = 'ellipsis'));
            }
          w.rotation &&
            ((I = F > 0.5 * c.chartHeight ? 0.33 * c.chartHeight : F),
            k || (h = 'ellipsis'));
          if (
            (this.labelAlign =
              a.align || this.autoLabelAlign(this.labelRotation))
          )
            w.align = this.labelAlign;
          l.forEach(function (b) {
            const c = (b = f[b]) && b.label,
              e = d.width,
              l = {};
            c &&
              (c.attr(w),
              b.shortenLabel
                ? b.shortenLabel()
                : I &&
                    !e &&
                    'nowrap' !== d.whiteSpace &&
                    (I < c.textPxLength || 'SPAN' === c.element.tagName)
                  ? ((l.width = I + 'px'),
                    k || (l.textOverflow = c.specificTextOverflow || h),
                    c.css(l))
                  : c.styles &&
                    c.styles.width &&
                    !l.width &&
                    !e &&
                    c.css({ width: null }),
              delete c.specificTextOverflow,
              (b.rotation = w.rotation));
          }, this);
          this.tickRotCorr = e.rotCorr(
            g.b,
            this.labelRotation || 0,
            0 !== this.side,
          );
        }
        hasData() {
          return (
            this.series.some(function (b) {
              return b.hasData();
            }) ||
            (this.options.showEmpty && k(this.min) && k(this.max))
          );
        }
        addTitle(b) {
          const e = this.chart.renderer,
            l = this.horiz,
            f = this.opposite,
            a = this.options.title,
            d = this.chart.styledMode;
          let n;
          this.axisTitle ||
            ((n = a.textAlign) ||
              (n = (
                l
                  ? { low: 'left', middle: 'center', high: 'right' }
                  : {
                      low: f ? 'right' : 'left',
                      middle: 'center',
                      high: f ? 'left' : 'right',
                    }
              )[a.align]),
            (this.axisTitle = e
              .text(a.text || '', 0, 0, a.useHTML)
              .attr({ zIndex: 7, rotation: a.rotation, align: n })
              .addClass('highcharts-axis-title')),
            d || this.axisTitle.css(c(a.style)),
            this.axisTitle.add(this.axisGroup),
            (this.axisTitle.isNew = !0));
          d ||
            a.style.width ||
            this.isRadial ||
            this.axisTitle.css({ width: this.len + 'px' });
          this.axisTitle[b ? 'show' : 'hide'](b);
        }
        generateTick(b) {
          const c = this.ticks;
          c[b] ? c[b].addLabel() : (c[b] = new D(this, b));
        }
        getOffset() {
          const b = this,
            {
              chart: c,
              horiz: l,
              options: f,
              side: a,
              ticks: d,
              tickPositions: n,
              coll: t,
              axisParent: w,
            } = b,
            g = c.renderer,
            h = c.inverted && !b.isZAxis ? [1, 0, 3, 2][a] : a;
          var m = b.hasData();
          const J = f.title;
          var v = f.labels;
          const q = e(f.crossing);
          var r = c.axisOffset;
          const y = c.clipOffset,
            O = [-1, 1, 1, -1][a],
            u = f.className;
          let S,
            K = 0,
            P;
          var Q = 0;
          let L = 0;
          b.showAxis = S = m || f.showEmpty;
          b.staggerLines = (b.horiz && v.staggerLines) || void 0;
          if (!b.axisGroup) {
            const c = (b, c, e) =>
              g
                .g(b)
                .attr({ zIndex: e })
                .addClass(
                  `highcharts-${t.toLowerCase()}${c} ` +
                    (this.isRadial ? `highcharts-radial-axis${c} ` : '') +
                    (u || ''),
                )
                .add(w);
            b.gridGroup = c('grid', '-grid', f.gridZIndex);
            b.axisGroup = c('axis', '', f.zIndex);
            b.labelGroup = c('axis-labels', '-labels', v.zIndex);
          }
          m || b.isLinked
            ? (n.forEach(function (c) {
                b.generateTick(c);
              }),
              b.renderUnsquish(),
              (b.reserveSpaceDefault =
                0 === a ||
                2 === a ||
                { 1: 'left', 3: 'right' }[a] === b.labelAlign),
              F(
                v.reserveSpace,
                q ? !1 : null,
                'center' === b.labelAlign ? !0 : null,
                b.reserveSpaceDefault,
              ) &&
                n.forEach(function (b) {
                  L = Math.max(d[b].getLabelSize(), L);
                }),
              b.staggerLines && (L *= b.staggerLines),
              (b.labelOffset = L * (b.opposite ? -1 : 1)))
            : I(d, function (b, c) {
                b.destroy();
                delete d[c];
              });
          J &&
            J.text &&
            !1 !== J.enabled &&
            (b.addTitle(S),
            S &&
              !q &&
              !1 !== J.reserveSpace &&
              ((b.titleOffset = K =
                b.axisTitle.getBBox()[l ? 'height' : 'width']),
              (P = J.offset),
              (Q = k(P) ? 0 : F(J.margin, l ? 5 : 10))));
          b.renderLine();
          b.offset = O * F(f.offset, r[a] ? r[a] + (f.margin || 0) : 0);
          b.tickRotCorr = b.tickRotCorr || { x: 0, y: 0 };
          m = 0 === a ? -b.labelMetrics().h : 2 === a ? b.tickRotCorr.y : 0;
          Q = Math.abs(L) + Q;
          L &&
            (Q =
              Q -
              m +
              O *
                (l
                  ? F(v.y, b.tickRotCorr.y + O * v.distance)
                  : F(v.x, O * v.distance)));
          b.axisTitleMargin = F(P, Q);
          b.getMaxLabelDimensions &&
            (b.maxLabelDimensions = b.getMaxLabelDimensions(d, n));
          'colorAxis' !== t &&
            ((v = this.tickSize('tick')),
            (r[a] = Math.max(
              r[a],
              (b.axisTitleMargin || 0) + K + O * b.offset,
              Q,
              n && n.length && v ? v[0] + O * b.offset : 0,
            )),
            (r =
              !b.axisLine || f.offset
                ? 0
                : 2 * Math.floor(b.axisLine.strokeWidth() / 2)),
            (y[h] = Math.max(y[h], r)));
          p(this, 'afterGetOffset');
        }
        getLinePath(b) {
          const c = this.chart,
            e = this.opposite;
          var l = this.offset;
          const f = this.horiz,
            a = this.left + (e ? this.width : 0) + l;
          l = c.chartHeight - this.bottom - (e ? this.height : 0) + l;
          e && (b *= -1);
          return c.renderer.crispLine(
            [
              ['M', f ? this.left : a, f ? l : this.top],
              [
                'L',
                f ? c.chartWidth - this.right : a,
                f ? l : c.chartHeight - this.bottom,
              ],
            ],
            b,
          );
        }
        renderLine() {
          this.axisLine ||
            ((this.axisLine = this.chart.renderer
              .path()
              .addClass('highcharts-axis-line')
              .add(this.axisGroup)),
            this.chart.styledMode ||
              this.axisLine.attr({
                stroke: this.options.lineColor,
                'stroke-width': this.options.lineWidth,
                zIndex: 7,
              }));
        }
        getTitlePosition(b) {
          var c = this.horiz,
            e = this.left;
          const l = this.top;
          var f = this.len;
          const a = this.options.title,
            d = c ? e : l,
            n = this.opposite,
            t = this.offset,
            w = a.x,
            g = a.y,
            k = this.chart.renderer.fontMetrics(b);
          b = b ? Math.max(b.getBBox(!1, 0).height - k.h - 1, 0) : 0;
          f = {
            low: d + (c ? 0 : f),
            middle: d + f / 2,
            high: d + (c ? f : 0),
          }[a.align];
          e =
            (c ? l + this.height : e) +
            (c ? 1 : -1) * (n ? -1 : 1) * (this.axisTitleMargin || 0) +
            [-b, b, k.f, -b][this.side];
          c = {
            x: c ? f + w : e + (n ? this.width : 0) + t + w,
            y: c ? e + g - (n ? this.height : 0) + t : f + g,
          };
          p(this, 'afterGetTitlePosition', { titlePosition: c });
          return c;
        }
        renderMinorTick(b, c) {
          const e = this.minorTicks;
          e[b] || (e[b] = new D(this, b, 'minor'));
          c && e[b].isNew && e[b].render(null, !0);
          e[b].render(null, !1, 1);
        }
        renderTick(b, c, e) {
          const l = this.ticks;
          if (
            !this.isLinked ||
            (b >= this.min && b <= this.max) ||
            (this.grid && this.grid.isColumn)
          )
            (l[b] || (l[b] = new D(this, b)),
              e && l[b].isNew && l[b].render(c, !0, -1),
              l[b].render(c));
        }
        render() {
          const b = this,
            c = b.chart,
            l = b.logarithmic,
            f = b.options,
            a = b.isLinked,
            d = b.tickPositions,
            n = b.axisTitle,
            t = b.ticks,
            w = b.minorTicks,
            g = b.alternateBands,
            k = f.stackLabels,
            h = f.alternateGridColor;
          var F = f.crossing;
          const m = b.tickmarkOffset,
            J = b.axisLine,
            v = b.showAxis,
            q = u(c.renderer.globalAnimation);
          let r, y;
          b.labelEdge.length = 0;
          b.overlap = !1;
          [t, w, g].forEach(function (b) {
            I(b, function (b) {
              b.isActive = !1;
            });
          });
          if (e(F)) {
            const e = this.isXAxis ? c.yAxis[0] : c.xAxis[0],
              l = [1, -1, -1, 1][this.side];
            e &&
              ((F = e.toPixels(F, !0)),
              b.horiz && (F = e.len - F),
              (b.offset = l * F));
          }
          if (b.hasData() || a) {
            const a = b.chart.hasRendered && b.old && e(b.old.min);
            b.minorTickInterval &&
              !b.categories &&
              b.getMinorTickPositions().forEach(function (c) {
                b.renderMinorTick(c, a);
              });
            d.length &&
              (d.forEach(function (c, e) {
                b.renderTick(c, e, a);
              }),
              m &&
                (0 === b.min || b.single) &&
                (t[-1] || (t[-1] = new D(b, -1, null, !0)), t[-1].render(-1)));
            h &&
              d.forEach(function (e, f) {
                y = 'undefined' !== typeof d[f + 1] ? d[f + 1] + m : b.max - m;
                0 === f % 2 &&
                  e < b.max &&
                  y <= b.max + (c.polar ? -m : m) &&
                  (g[e] || (g[e] = new z.PlotLineOrBand(b)),
                  (r = e + m),
                  (g[e].options = {
                    from: l ? l.lin2log(r) : r,
                    to: l ? l.lin2log(y) : y,
                    color: h,
                    className: 'highcharts-alternate-grid',
                  }),
                  g[e].render(),
                  (g[e].isActive = !0));
              });
            b._addedPlotLB ||
              ((b._addedPlotLB = !0),
              (f.plotLines || [])
                .concat(f.plotBands || [])
                .forEach(function (c) {
                  b.addPlotBandOrLine(c);
                }));
          }
          [t, w, g].forEach(function (b) {
            const e = [],
              l = q.duration;
            I(b, function (b, c) {
              b.isActive || (b.render(c, !1, 0), (b.isActive = !1), e.push(c));
            });
            O(
              function () {
                let c = e.length;
                for (; c--; )
                  b[e[c]] &&
                    !b[e[c]].isActive &&
                    (b[e[c]].destroy(), delete b[e[c]]);
              },
              b !== g && c.hasRendered && l ? l : 0,
            );
          });
          J &&
            (J[J.isPlaced ? 'animate' : 'attr']({
              d: this.getLinePath(J.strokeWidth()),
            }),
            (J.isPlaced = !0),
            J[v ? 'show' : 'hide'](v));
          n &&
            v &&
            (n[n.isNew ? 'attr' : 'animate'](b.getTitlePosition(n)),
            (n.isNew = !1));
          k && k.enabled && b.stacking && b.stacking.renderStackTotals();
          b.old = {
            len: b.len,
            max: b.max,
            min: b.min,
            transA: b.transA,
            userMax: b.userMax,
            userMin: b.userMin,
          };
          b.isDirty = !1;
          p(this, 'afterRender');
        }
        redraw() {
          this.visible &&
            (this.render(),
            this.plotLinesAndBands.forEach(function (b) {
              b.render();
            }));
          this.series.forEach(function (b) {
            b.isDirty = !0;
          });
        }
        getKeepProps() {
          return this.keepProps || W.keepProps;
        }
        destroy(b) {
          const c = this,
            e = c.plotLinesAndBands,
            l = this.eventOptions;
          p(this, 'destroy', { keepEvents: b });
          b || S(c);
          [c.ticks, c.minorTicks, c.alternateBands].forEach(function (b) {
            y(b);
          });
          if (e) for (b = e.length; b--; ) e[b].destroy();
          'axisLine axisTitle axisGroup gridGroup labelGroup cross scrollbar'
            .split(' ')
            .forEach(function (b) {
              c[b] && (c[b] = c[b].destroy());
            });
          for (const b in c.plotLinesAndBandsGroups)
            c.plotLinesAndBandsGroups[b] =
              c.plotLinesAndBandsGroups[b].destroy();
          I(c, function (b, e) {
            -1 === c.getKeepProps().indexOf(e) && delete c[e];
          });
          this.eventOptions = l;
        }
        drawCrosshair(b, c) {
          const e = this.crosshair;
          var l = F(e && e.snap, !0);
          const a = this.chart;
          let d,
            n = this.cross;
          p(this, 'drawCrosshair', { e: b, point: c });
          b || (b = this.cross && this.cross.e);
          if (e && !1 !== (k(c) || !l)) {
            l
              ? k(c) &&
                (d = F(
                  'colorAxis' !== this.coll ? c.crosshairPos : null,
                  this.isXAxis ? c.plotX : this.len - c.plotY,
                ))
              : (d =
                  b &&
                  (this.horiz
                    ? b.chartX - this.pos
                    : this.len - b.chartY + this.pos));
            if (k(d)) {
              var t = {
                value: c && (this.isXAxis ? c.x : F(c.stackY, c.y)),
                translatedValue: d,
              };
              a.polar &&
                f(t, {
                  isCrosshair: !0,
                  chartX: b && b.chartX,
                  chartY: b && b.chartY,
                  point: c,
                });
              t = this.getPlotLinePath(t) || null;
            }
            if (!k(t)) {
              this.hideCrosshair();
              return;
            }
            l = this.categories && !this.isRadial;
            n ||
              ((this.cross = n =
                a.renderer
                  .path()
                  .addClass(
                    'highcharts-crosshair highcharts-crosshair-' +
                      (l ? 'category ' : 'thin ') +
                      (e.className || ''),
                  )
                  .attr({ zIndex: F(e.zIndex, 2) })
                  .add()),
              a.styledMode ||
                (n
                  .attr({
                    stroke:
                      e.color ||
                      (l
                        ? G.parse('#ccd3ff').setOpacity(0.25).get()
                        : '#cccccc'),
                    'stroke-width': F(e.width, 1),
                  })
                  .css({ 'pointer-events': 'none' }),
                e.dashStyle && n.attr({ dashstyle: e.dashStyle })));
            n.show().attr({ d: t });
            l && !e.width && n.attr({ 'stroke-width': this.transA });
            this.cross.e = b;
          } else this.hideCrosshair();
          p(this, 'afterDrawCrosshair', { e: b, point: c });
        }
        hideCrosshair() {
          this.cross && this.cross.hide();
          p(this, 'afterHideCrosshair');
        }
        hasVerticalPanning() {
          const b = this.chart.options.chart.panning;
          return !!(b && b.enabled && /y/.test(b.type));
        }
        update(b, e) {
          const l = this.chart;
          b = c(this.userOptions, b);
          this.destroy(!0);
          this.init(l, b);
          l.isDirtyBox = !0;
          F(e, !0) && l.redraw();
        }
        remove(b) {
          const c = this.chart,
            e = this.coll,
            l = this.series;
          let f = l.length;
          for (; f--; ) l[f] && l[f].remove(!1);
          K(c.axes, this);
          K(c[e] || [], this);
          c.orderItems(e);
          this.destroy();
          c.isDirtyBox = !0;
          F(b, !0) && c.redraw();
        }
        setTitle(b, c) {
          this.update({ title: b }, c);
        }
        setCategories(b, c) {
          this.update({ categories: b }, c);
        }
      }
      W.defaultOptions = A.defaultXAxisOptions;
      W.keepProps = 'coll extKey hcEvents names series userMax userMin'.split(
        ' ',
      );
      ('');
      return W;
    },
  );
  M(a, 'Core/Axis/DateTimeAxis.js', [a['Core/Utilities.js']], function (a) {
    const {
      addEvent: x,
      getMagnitude: G,
      normalizeTickInterval: H,
      timeUnits: C,
    } = a;
    var z;
    (function (D) {
      function B() {
        return this.chart.time.getTimeTicks.apply(this.chart.time, arguments);
      }
      function u(a) {
        'datetime' !== a.userOptions.type
          ? (this.dateTime = void 0)
          : this.dateTime || (this.dateTime = new r(this));
      }
      const q = [];
      D.compose = function (m) {
        a.pushUnique(q, m) &&
          (m.keepProps.push('dateTime'),
          (m.prototype.getTimeTicks = B),
          x(m, 'init', u));
        return m;
      };
      class r {
        constructor(a) {
          this.axis = a;
        }
        normalizeTimeTickInterval(a, v) {
          const h = v || [
            ['millisecond', [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]],
            ['second', [1, 2, 5, 10, 15, 30]],
            ['minute', [1, 2, 5, 10, 15, 30]],
            ['hour', [1, 2, 3, 4, 6, 8, 12]],
            ['day', [1, 2]],
            ['week', [1, 2]],
            ['month', [1, 2, 3, 4, 6]],
            ['year', null],
          ];
          v = h[h.length - 1];
          let g = C[v[0]],
            d = v[1],
            k;
          for (
            k = 0;
            k < h.length &&
            !((v = h[k]),
            (g = C[v[0]]),
            (d = v[1]),
            h[k + 1] && a <= (g * d[d.length - 1] + C[h[k + 1][0]]) / 2);
            k++
          );
          g === C.year && a < 5 * g && (d = [1, 2, 5]);
          a = H(a / g, d, 'year' === v[0] ? Math.max(G(a / g), 1) : 1);
          return { unitRange: g, count: a, unitName: v[0] };
        }
        getXDateFormat(a, v) {
          const { axis: h } = this,
            g = h.chart.time;
          return h.closestPointRange
            ? g.getDateFormat(
                h.closestPointRange,
                a,
                h.options.startOfWeek,
                v,
              ) || g.resolveDTLFormat(v.year).main
            : g.resolveDTLFormat(v.day).main;
        }
      }
      D.Additions = r;
    })(z || (z = {}));
    return z;
  });
  M(a, 'Core/Axis/LogarithmicAxis.js', [a['Core/Utilities.js']], function (a) {
    const { addEvent: x, normalizeTickInterval: G, pick: H } = a;
    var C;
    (function (z) {
      function D(a) {
        let m = this.logarithmic;
        'logarithmic' !== a.userOptions.type
          ? (this.logarithmic = void 0)
          : m || (this.logarithmic = new q(this));
      }
      function B() {
        const a = this.logarithmic;
        a &&
          ((this.lin2val = function (m) {
            return a.lin2log(m);
          }),
          (this.val2lin = function (m) {
            return a.log2lin(m);
          }));
      }
      const u = [];
      z.compose = function (q) {
        a.pushUnique(u, q) &&
          (q.keepProps.push('logarithmic'),
          x(q, 'init', D),
          x(q, 'afterInit', B));
        return q;
      };
      class q {
        constructor(a) {
          this.axis = a;
        }
        getLogTickPositions(a, m, v, h) {
          const g = this.axis;
          var d = g.len,
            k = g.options;
          let q = [];
          h || (this.minorAutoInterval = void 0);
          if (0.5 <= a)
            ((a = Math.round(a)), (q = g.getLinearTickPositions(a, m, v)));
          else if (0.08 <= a) {
            k = Math.floor(m);
            let g, y, f, p, t;
            for (
              d =
                0.3 < a
                  ? [1, 2, 4]
                  : 0.15 < a
                    ? [1, 2, 4, 6, 8]
                    : [1, 2, 3, 4, 5, 6, 7, 8, 9];
              k < v + 1 && !t;
              k++
            )
              for (y = d.length, g = 0; g < y && !t; g++)
                ((f = this.log2lin(this.lin2log(k) * d[g])),
                  f > m &&
                    (!h || p <= v) &&
                    'undefined' !== typeof p &&
                    q.push(p),
                  p > v && (t = !0),
                  (p = f));
          } else
            ((m = this.lin2log(m)),
              (v = this.lin2log(v)),
              (a = h ? g.getMinorTickInterval() : k.tickInterval),
              (a = H(
                'auto' === a ? null : a,
                this.minorAutoInterval,
                ((k.tickPixelInterval / (h ? 5 : 1)) * (v - m)) /
                  ((h ? d / g.tickPositions.length : d) || 1),
              )),
              (a = G(a)),
              (q = g.getLinearTickPositions(a, m, v).map(this.log2lin)),
              h || (this.minorAutoInterval = a / 5));
          h || (g.tickInterval = a);
          return q;
        }
        lin2log(a) {
          return Math.pow(10, a);
        }
        log2lin(a) {
          return Math.log(a) / Math.LN10;
        }
      }
      z.Additions = q;
    })(C || (C = {}));
    return C;
  });
  M(
    a,
    'Core/Axis/PlotLineOrBand/PlotLineOrBandAxis.js',
    [a['Core/Utilities.js']],
    function (a) {
      const { erase: x, extend: G, isNumber: H } = a;
      var C;
      (function (z) {
        function D(a) {
          return this.addPlotBandOrLine(a, 'plotBands');
        }
        function B(a, k) {
          const d = this.userOptions;
          let h = new g(this, a);
          this.visible && (h = h.render());
          if (h) {
            this._addedPlotLB ||
              ((this._addedPlotLB = !0),
              (d.plotLines || []).concat(d.plotBands || []).forEach((a) => {
                this.addPlotBandOrLine(a);
              }));
            if (k) {
              const g = d[k] || [];
              g.push(a);
              d[k] = g;
            }
            this.plotLinesAndBands.push(h);
          }
          return h;
        }
        function u(a) {
          return this.addPlotBandOrLine(a, 'plotLines');
        }
        function q(a, g, h = this.options) {
          const d = this.getPlotLinePath({
              value: g,
              force: !0,
              acrossPanes: h.acrossPanes,
            }),
            k = [],
            f = this.horiz;
          g =
            !H(this.min) ||
            !H(this.max) ||
            (a < this.min && g < this.min) ||
            (a > this.max && g > this.max);
          a = this.getPlotLinePath({
            value: a,
            force: !0,
            acrossPanes: h.acrossPanes,
          });
          h = 1;
          let p;
          if (a && d)
            for (
              g && ((p = a.toString() === d.toString()), (h = 0)), g = 0;
              g < a.length;
              g += 2
            ) {
              const t = a[g],
                n = a[g + 1],
                w = d[g],
                e = d[g + 1];
              ('M' !== t[0] && 'L' !== t[0]) ||
                ('M' !== n[0] && 'L' !== n[0]) ||
                ('M' !== w[0] && 'L' !== w[0]) ||
                ('M' !== e[0] && 'L' !== e[0]) ||
                (f && w[1] === t[1]
                  ? ((w[1] += h), (e[1] += h))
                  : f || w[2] !== t[2] || ((w[2] += h), (e[2] += h)),
                k.push(
                  ['M', t[1], t[2]],
                  ['L', n[1], n[2]],
                  ['L', e[1], e[2]],
                  ['L', w[1], w[2]],
                  ['Z'],
                ));
              k.isFlat = p;
            }
          return k;
        }
        function r(a) {
          this.removePlotBandOrLine(a);
        }
        function m(a) {
          const d = this.plotLinesAndBands,
            g = this.options,
            h = this.userOptions;
          if (d) {
            let k = d.length;
            for (; k--; ) d[k].id === a && d[k].destroy();
            [
              g.plotLines || [],
              h.plotLines || [],
              g.plotBands || [],
              h.plotBands || [],
            ].forEach(function (f) {
              for (k = f.length; k--; ) (f[k] || {}).id === a && x(f, f[k]);
            });
          }
        }
        function v(a) {
          this.removePlotBandOrLine(a);
        }
        const h = [];
        let g;
        z.compose = function (d, k) {
          g || (g = d);
          a.pushUnique(h, k) &&
            G(k.prototype, {
              addPlotBand: D,
              addPlotLine: u,
              addPlotBandOrLine: B,
              getPlotBandPath: q,
              removePlotBand: r,
              removePlotLine: v,
              removePlotBandOrLine: m,
            });
          return k;
        };
      })(C || (C = {}));
      return C;
    },
  );
  M(
    a,
    'Core/Axis/PlotLineOrBand/PlotLineOrBand.js',
    [
      a['Core/Axis/PlotLineOrBand/PlotLineOrBandAxis.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A) {
      const {
        arrayMax: x,
        arrayMin: H,
        defined: C,
        destroyObjectProperties: z,
        erase: D,
        fireEvent: B,
        merge: u,
        objectEach: q,
        pick: r,
      } = A;
      class m {
        static compose(v) {
          return a.compose(m, v);
        }
        constructor(a, h) {
          this.axis = a;
          h && ((this.options = h), (this.id = h.id));
        }
        render() {
          B(this, 'render');
          const a = this,
            h = a.axis,
            g = h.horiz;
          var d = h.logarithmic;
          const k = a.options,
            m = k.color,
            K = r(k.zIndex, 0),
            L = k.events,
            f = {},
            p = h.chart.renderer;
          let t = k.label,
            n = a.label,
            w = k.to,
            e = k.from,
            b = k.value,
            c = a.svgElem;
          var l = [];
          const I = C(e) && C(w);
          l = C(b);
          const F = !c,
            J = {
              class:
                'highcharts-plot-' +
                (I ? 'band ' : 'line ') +
                (k.className || ''),
            };
          let S = I ? 'bands' : 'lines';
          d && ((e = d.log2lin(e)), (w = d.log2lin(w)), (b = d.log2lin(b)));
          h.chart.styledMode ||
            (l
              ? ((J.stroke = m || '#999999'),
                (J['stroke-width'] = r(k.width, 1)),
                k.dashStyle && (J.dashstyle = k.dashStyle))
              : I &&
                ((J.fill = m || '#e6e9ff'),
                k.borderWidth &&
                  ((J.stroke = k.borderColor),
                  (J['stroke-width'] = k.borderWidth))));
          f.zIndex = K;
          S += '-' + K;
          (d = h.plotLinesAndBandsGroups[S]) ||
            (h.plotLinesAndBandsGroups[S] = d =
              p
                .g('plot-' + S)
                .attr(f)
                .add());
          F && (a.svgElem = c = p.path().attr(J).add(d));
          if (l)
            l = h.getPlotLinePath({
              value: b,
              lineWidth: c.strokeWidth(),
              acrossPanes: k.acrossPanes,
            });
          else if (I) l = h.getPlotBandPath(e, w, k);
          else return;
          !a.eventsAdded &&
            L &&
            (q(L, function (b, e) {
              c.on(e, function (b) {
                L[e].apply(a, [b]);
              });
            }),
            (a.eventsAdded = !0));
          (F || !c.d) && l && l.length
            ? c.attr({ d: l })
            : c &&
              (l
                ? (c.show(), c.animate({ d: l }))
                : c.d && (c.hide(), n && (a.label = n = n.destroy())));
          t &&
          (C(t.text) || C(t.formatter)) &&
          l &&
          l.length &&
          0 < h.width &&
          0 < h.height &&
          !l.isFlat
            ? ((t = u(
                {
                  align: g && I && 'center',
                  x: g ? !I && 4 : 10,
                  verticalAlign: !g && I && 'middle',
                  y: g ? (I ? 16 : 10) : I ? 6 : -4,
                  rotation: g && !I && 90,
                },
                t,
              )),
              this.renderLabel(t, l, I, K))
            : n && n.hide();
          return a;
        }
        renderLabel(a, h, g, d) {
          const k = this.axis;
          var m = k.chart.renderer;
          let q = this.label;
          q ||
            ((this.label = q =
              m
                .text(this.getLabelText(a), 0, 0, a.useHTML)
                .attr({
                  align: a.textAlign || a.align,
                  rotation: a.rotation,
                  class:
                    'highcharts-plot-' +
                    (g ? 'band' : 'line') +
                    '-label ' +
                    (a.className || ''),
                  zIndex: d,
                })
                .add()),
            k.chart.styledMode ||
              q.css(
                u({ fontSize: '0.8em', textOverflow: 'ellipsis' }, a.style),
              ));
          d = h.xBounds || [h[0][1], h[1][1], g ? h[2][1] : h[0][1]];
          h = h.yBounds || [h[0][2], h[1][2], g ? h[2][2] : h[0][2]];
          g = H(d);
          m = H(h);
          q.align(a, !1, { x: g, y: m, width: x(d) - g, height: x(h) - m });
          (q.alignValue && 'left' !== q.alignValue) ||
            ((a = a.clip ? k.width : k.chart.chartWidth),
            q.css({
              width:
                (90 === q.rotation
                  ? k.height - (q.alignAttr.y - k.top)
                  : a - (q.alignAttr.x - k.left)) + 'px',
            }));
          q.show(!0);
        }
        getLabelText(a) {
          return C(a.formatter) ? a.formatter.call(this) : a.text;
        }
        destroy() {
          D(this.axis.plotLinesAndBands, this);
          delete this.axis;
          z(this);
        }
      }
      ('');
      ('');
      return m;
    },
  );
  M(
    a,
    'Core/Tooltip.js',
    [
      a['Core/Templating.js'],
      a['Core/Globals.js'],
      a['Core/Renderer/RendererUtilities.js'],
      a['Core/Renderer/RendererRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C) {
      const { format: x } = a,
        { doc: D, isSafari: B } = A,
        { distribute: u } = G,
        {
          addEvent: q,
          clamp: r,
          css: m,
          discardElement: v,
          extend: h,
          fireEvent: g,
          isArray: d,
          isNumber: k,
          isString: y,
          merge: K,
          pick: L,
          splat: f,
          syncTimeout: p,
        } = C;
      class t {
        constructor(f, a) {
          this.allowShared = !0;
          this.container = void 0;
          this.crosshairs = [];
          this.distance = 0;
          this.isHidden = !0;
          this.isSticky = !1;
          this.now = {};
          this.options = {};
          this.outside = !1;
          this.chart = f;
          this.init(f, a);
        }
        bodyFormatter(f) {
          return f.map(function (f) {
            const e = f.series.tooltipOptions;
            return (
              e[(f.point.formatPrefix || 'point') + 'Formatter'] ||
              f.point.tooltipFormatter
            ).call(
              f.point,
              e[(f.point.formatPrefix || 'point') + 'Format'] || '',
            );
          });
        }
        cleanSplit(f) {
          this.chart.series.forEach(function (a) {
            const e = a && a.tt;
            e && (!e.isActive || f ? (a.tt = e.destroy()) : (e.isActive = !1));
          });
        }
        defaultFormatter(a) {
          const d = this.points || f(this);
          let e;
          e = [a.tooltipFooterHeaderFormatter(d[0])];
          e = e.concat(a.bodyFormatter(d));
          e.push(a.tooltipFooterHeaderFormatter(d[0], !0));
          return e;
        }
        destroy() {
          this.label && (this.label = this.label.destroy());
          this.split &&
            (this.cleanSplit(!0), this.tt && (this.tt = this.tt.destroy()));
          this.renderer &&
            ((this.renderer = this.renderer.destroy()), v(this.container));
          C.clearTimeout(this.hideTimer);
          C.clearTimeout(this.tooltipTimeout);
        }
        getAnchor(a, d) {
          var e = this.chart;
          const b = e.pointer,
            c = e.inverted,
            l = e.plotTop;
          e = e.plotLeft;
          a = f(a);
          a[0].series &&
            a[0].series.yAxis &&
            !a[0].series.yAxis.options.reversedStacks &&
            (a = a.slice().reverse());
          if (this.followPointer && d)
            ('undefined' === typeof d.chartX && (d = b.normalize(d)),
              (a = [d.chartX - e, d.chartY - l]));
          else if (a[0].tooltipPos) a = a[0].tooltipPos;
          else {
            let b = 0,
              f = 0;
            a.forEach(function (c) {
              if ((c = c.pos(!0))) ((b += c[0]), (f += c[1]));
            });
            b /= a.length;
            f /= a.length;
            this.shared &&
              1 < a.length &&
              d &&
              (c ? (b = d.chartX) : (f = d.chartY));
            a = [b - e, f - l];
          }
          return a.map(Math.round);
        }
        getClassName(a, f, e) {
          const b = a.series,
            c = b.options;
          return [
            this.options.className,
            'highcharts-label',
            e && 'highcharts-tooltip-header',
            f ? 'highcharts-tooltip-box' : 'highcharts-tooltip',
            !e && 'highcharts-color-' + L(a.colorIndex, b.colorIndex),
            c && c.className,
          ]
            .filter(y)
            .join(' ');
        }
        getLabel() {
          const a = this,
            f = this.chart.styledMode,
            e = this.options,
            b = this.split && this.allowShared,
            c =
              e.style.pointerEvents ||
              (this.shouldStickOnContact() ? 'auto' : 'none');
          let l,
            d = this.chart.renderer;
          if (this.label) {
            var p = !this.label.hasClass('highcharts-label');
            ((!b && p) || (b && !p)) && this.destroy();
          }
          if (!this.label) {
            if (this.outside) {
              p = this.chart.options.chart.style;
              const b = H.getRendererType();
              this.container = l = A.doc.createElement('div');
              l.className = 'highcharts-tooltip-container';
              m(l, {
                position: 'absolute',
                top: '1px',
                pointerEvents: c,
                zIndex: Math.max(
                  this.options.style.zIndex || 0,
                  ((p && p.zIndex) || 0) + 3,
                ),
              });
              A.doc.body.appendChild(l);
              this.renderer = d = new b(
                l,
                0,
                0,
                p,
                void 0,
                void 0,
                d.styledMode,
              );
            }
            b
              ? (this.label = d.g('tooltip'))
              : ((this.label = d
                  .label(
                    '',
                    0,
                    0,
                    e.shape,
                    void 0,
                    void 0,
                    e.useHTML,
                    void 0,
                    'tooltip',
                  )
                  .attr({ padding: e.padding, r: e.borderRadius })),
                f ||
                  this.label
                    .attr({
                      fill: e.backgroundColor,
                      'stroke-width': e.borderWidth || 0,
                    })
                    .css(e.style)
                    .css({ pointerEvents: c }));
            if (a.outside) {
              const b = this.label,
                { xSetter: c, ySetter: e } = b;
              b.xSetter = function (e) {
                c.call(b, a.distance);
                l.style.left = e + 'px';
              };
              b.ySetter = function (c) {
                e.call(b, a.distance);
                l.style.top = c + 'px';
              };
            }
            this.label.attr({ zIndex: 8 }).shadow(e.shadow).add();
          }
          return this.label;
        }
        getPlayingField() {
          const { body: a, documentElement: f } = D,
            { chart: e, distance: b, outside: c } = this;
          return {
            width: c
              ? Math.max(
                  a.scrollWidth,
                  f.scrollWidth,
                  a.offsetWidth,
                  f.offsetWidth,
                  f.clientWidth,
                ) -
                2 * b
              : e.chartWidth,
            height: c
              ? Math.max(
                  a.scrollHeight,
                  f.scrollHeight,
                  a.offsetHeight,
                  f.offsetHeight,
                  f.clientHeight,
                )
              : e.chartHeight,
          };
        }
        getPosition(a, f, e) {
          const b = this.chart,
            c = this.distance,
            l = {},
            d = (b.inverted && e.h) || 0,
            n = this.outside;
          var p = this.getPlayingField();
          const t = p.width,
            g = p.height,
            w = b.pointer.getChartPosition();
          p = (l) => {
            const d = 'x' === l;
            return [l, d ? t : g, d ? a : f].concat(
              n
                ? [
                    d ? a * w.scaleX : f * w.scaleY,
                    d
                      ? w.left - c + (e.plotX + b.plotLeft) * w.scaleX
                      : w.top - c + (e.plotY + b.plotTop) * w.scaleY,
                    0,
                    d ? t : g,
                  ]
                : [
                    d ? a : f,
                    d ? e.plotX + b.plotLeft : e.plotY + b.plotTop,
                    d ? b.plotLeft : b.plotTop,
                    d ? b.plotLeft + b.plotWidth : b.plotTop + b.plotHeight,
                  ],
            );
          };
          let k = p('y'),
            h = p('x'),
            m;
          p = !!e.negative;
          !b.polar &&
            b.hoverSeries &&
            b.hoverSeries.yAxis &&
            b.hoverSeries.yAxis.reversed &&
            (p = !p);
          const q = !this.followPointer && L(e.ttBelow, !b.inverted === p),
            v = function (b, e, a, f, p, t, g) {
              const k = n ? ('y' === b ? c * w.scaleY : c * w.scaleX) : c,
                h = (a - f) / 2,
                I = f < p - c,
                F = p + c + f < e,
                m = p - k - a + h;
              p = p + k - h;
              if (q && F) l[b] = p;
              else if (!q && I) l[b] = m;
              else if (I) l[b] = Math.min(g - f, 0 > m - d ? m : m - d);
              else if (F) l[b] = Math.max(t, p + d + a > e ? p : p + d);
              else return !1;
            },
            r = function (b, e, a, f, d) {
              let n;
              d < c || d > e - c
                ? (n = !1)
                : (l[b] =
                    d < a / 2 ? 1 : d > e - f / 2 ? e - f - 2 : d - a / 2);
              return n;
            },
            y = function (b) {
              const c = k;
              k = h;
              h = c;
              m = b;
            },
            N = function () {
              !1 !== v.apply(0, k)
                ? !1 !== r.apply(0, h) || m || (y(!0), N())
                : m
                  ? (l.x = l.y = 0)
                  : (y(!0), N());
            };
          (b.inverted || 1 < this.len) && y();
          N();
          return l;
        }
        hide(a) {
          const f = this;
          C.clearTimeout(this.hideTimer);
          a = L(a, this.options.hideDelay);
          this.isHidden ||
            (this.hideTimer = p(function () {
              f.getLabel().fadeOut(a ? void 0 : a);
              f.isHidden = !0;
            }, a));
        }
        init(a, f) {
          this.chart = a;
          this.options = f;
          this.crosshairs = [];
          this.now = { x: 0, y: 0 };
          this.isHidden = !0;
          this.split = f.split && !a.inverted && !a.polar;
          this.shared = f.shared || this.split;
          this.outside = L(
            f.outside,
            !(!a.scrollablePixelsX && !a.scrollablePixelsY),
          );
        }
        shouldStickOnContact(a) {
          return !(
            this.followPointer ||
            !this.options.stickOnContact ||
            (a && !this.chart.pointer.inClass(a.target, 'highcharts-tooltip'))
          );
        }
        move(a, f, e, b) {
          const c = this,
            l = c.now,
            d =
              !1 !== c.options.animation &&
              !c.isHidden &&
              (1 < Math.abs(a - l.x) || 1 < Math.abs(f - l.y)),
            n = c.followPointer || 1 < c.len;
          h(l, {
            x: d ? (2 * l.x + a) / 3 : a,
            y: d ? (l.y + f) / 2 : f,
            anchorX: n ? void 0 : d ? (2 * l.anchorX + e) / 3 : e,
            anchorY: n ? void 0 : d ? (l.anchorY + b) / 2 : b,
          });
          c.getLabel().attr(l);
          c.drawTracker();
          d &&
            (C.clearTimeout(this.tooltipTimeout),
            (this.tooltipTimeout = setTimeout(function () {
              c && c.move(a, f, e, b);
            }, 32)));
        }
        refresh(a, p) {
          const e = this.chart,
            b = this.options,
            c = e.pointer,
            l = f(a),
            n = l[0],
            t = [];
          var w = b.format,
            k = b.formatter || this.defaultFormatter;
          const h = this.shared,
            m = e.styledMode;
          let q = {};
          if (b.enabled && n.series) {
            C.clearTimeout(this.hideTimer);
            this.allowShared = !(!d(a) && a.series && a.series.noSharedTooltip);
            this.followPointer =
              !this.split && n.series.tooltipOptions.followPointer;
            a = this.getAnchor(a, p);
            var v = a[0],
              r = a[1];
            h && this.allowShared
              ? (c.applyInactiveState(l),
                l.forEach(function (b) {
                  b.setState('hover');
                  t.push(b.getLabelConfig());
                }),
                (q = n.getLabelConfig()),
                (q.points = t))
              : (q = n.getLabelConfig());
            this.len = t.length;
            w = y(w) ? x(w, q, e) : k.call(q, this);
            k = n.series;
            this.distance = L(k.tooltipOptions.distance, 16);
            if (!1 === w) this.hide();
            else {
              if (this.split && this.allowShared) this.renderSplit(w, l);
              else {
                let f = v,
                  d = r;
                p &&
                  c.isDirectTouch &&
                  ((f = p.chartX - e.plotLeft), (d = p.chartY - e.plotTop));
                if (
                  e.polar ||
                  !1 === k.options.clip ||
                  l.some(
                    (b) => c.isDirectTouch || b.series.shouldShowTooltip(f, d),
                  )
                )
                  ((p = this.getLabel()),
                    (b.style.width && !m) ||
                      p.css({
                        width:
                          (this.outside ? this.getPlayingField() : e.spacingBox)
                            .width + 'px',
                      }),
                    p.attr({ text: w && w.join ? w.join('') : w }),
                    p.addClass(this.getClassName(n), !0),
                    m ||
                      p.attr({
                        stroke:
                          b.borderColor || n.color || k.color || '#666666',
                      }),
                    this.updatePosition({
                      plotX: v,
                      plotY: r,
                      negative: n.negative,
                      ttBelow: n.ttBelow,
                      h: a[2] || 0,
                    }));
                else {
                  this.hide();
                  return;
                }
              }
              this.isHidden &&
                this.label &&
                this.label.attr({ opacity: 1 }).show();
              this.isHidden = !1;
            }
            g(this, 'refresh');
          }
        }
        renderSplit(a, f) {
          function e(c, e, a, f, l = !0) {
            a
              ? ((e = A ? 0 : ca),
                (c = r(c - f / 2, N.left, N.right - f - (b.outside ? V : 0))))
              : ((e -= G),
                (c = l ? c - f - K : c + K),
                (c = r(c, l ? c : N.left, N.right)));
            return { x: c, y: e };
          }
          const b = this,
            {
              chart: c,
              chart: {
                chartWidth: l,
                chartHeight: d,
                plotHeight: p,
                plotLeft: n,
                plotTop: t,
                pointer: g,
                scrollablePixelsY: w = 0,
                scrollablePixelsX: k,
                scrollingContainer: { scrollLeft: m, scrollTop: q } = {
                  scrollLeft: 0,
                  scrollTop: 0,
                },
                styledMode: v,
              },
              distance: K,
              options: x,
              options: { positioner: z },
            } = b,
            N =
              b.outside && 'number' !== typeof k
                ? D.documentElement.getBoundingClientRect()
                : { left: m, right: m + l, top: q, bottom: q + d },
            X = b.getLabel(),
            R = this.renderer || c.renderer,
            A = !(!c.xAxis[0] || !c.xAxis[0].opposite),
            { left: V, top: C } = g.getChartPosition();
          let G = t + q,
            H = 0,
            ca = p - w;
          y(a) && (a = [!1, a]);
          a = a.slice(0, f.length + 1).reduce(function (c, a, l) {
            if (!1 !== a && '' !== a) {
              l = f[l - 1] || {
                isHeader: !0,
                plotX: f[0].plotX,
                plotY: p,
                series: {},
              };
              const I = l.isHeader;
              var d = I ? b : l.series,
                g;
              {
                var w = l;
                a = a.toString();
                var k = d.tt;
                const { isHeader: c, series: e } = w;
                k ||
                  ((k = { padding: x.padding, r: x.borderRadius }),
                  v ||
                    ((k.fill = x.backgroundColor),
                    (k['stroke-width'] =
                      null !== (g = x.borderWidth) && void 0 !== g ? g : 1)),
                  (k = R.label(
                    '',
                    0,
                    0,
                    x[c ? 'headerShape' : 'shape'],
                    void 0,
                    void 0,
                    x.useHTML,
                  )
                    .addClass(b.getClassName(w, !0, c))
                    .attr(k)
                    .add(X)));
                k.isActive = !0;
                k.attr({ text: a });
                v ||
                  k.css(x.style).attr({
                    stroke: x.borderColor || w.color || e.color || '#333333',
                  });
                g = k;
              }
              g = d.tt = g;
              w = g.getBBox();
              d = w.width + g.strokeWidth();
              I && ((H = w.height), (ca += H), A && (G -= H));
              {
                const {
                  isHeader: b,
                  plotX: c = 0,
                  plotY: e = 0,
                  series: f,
                } = l;
                if (b) {
                  a = n + c;
                  var h = t + p / 2;
                } else {
                  const { xAxis: b, yAxis: l } = f;
                  a = b.pos + r(c, -K, b.len + K);
                  f.shouldShowTooltip(0, l.pos - t + e, { ignoreX: !0 }) &&
                    (h = l.pos + e);
                }
                a = r(a, N.left - K, N.right + K);
                h = { anchorX: a, anchorY: h };
              }
              const { anchorX: m, anchorY: F } = h;
              'number' === typeof F
                ? ((h = w.height + 1),
                  (w = z ? z.call(b, d, h, l) : e(m, F, I, d)),
                  c.push({
                    align: z ? 0 : void 0,
                    anchorX: m,
                    anchorY: F,
                    boxWidth: d,
                    point: l,
                    rank: L(w.rank, I ? 1 : 0),
                    size: h,
                    target: w.y,
                    tt: g,
                    x: w.x,
                  }))
                : (g.isActive = !1);
            }
            return c;
          }, []);
          !z &&
            a.some((c) => {
              var { outside: e } = b;
              e = (e ? V : 0) + c.anchorX;
              return e < N.left && e + c.boxWidth < N.right
                ? !0
                : e < V - N.left + c.boxWidth && N.right - e > e;
            }) &&
            (a = a.map((b) => {
              const { x: c, y: a } = e(
                b.anchorX,
                b.anchorY,
                b.point.isHeader,
                b.boxWidth,
                !1,
              );
              return h(b, { target: a, x: c });
            }));
          b.cleanSplit();
          u(a, ca);
          var ba = V,
            M = V;
          a.forEach(function (c) {
            const { x: e, boxWidth: a, isHeader: f } = c;
            f ||
              (b.outside && V + e < ba && (ba = V + e),
              !f && b.outside && ba + a > M && (M = V + e));
          });
          a.forEach(function (c) {
            const {
                x: e,
                anchorX: a,
                anchorY: f,
                pos: l,
                point: { isHeader: d },
              } = c,
              p = {
                visibility: 'undefined' === typeof l ? 'hidden' : 'inherit',
                x: e,
                y: (l || 0) + G,
                anchorX: a,
                anchorY: f,
              };
            if (b.outside && e < a) {
              const b = V - ba;
              0 < b &&
                (d || ((p.x = e + b), (p.anchorX = a + b)),
                d && ((p.x = (M - ba) / 2), (p.anchorX = a + b)));
            }
            c.tt.attr(p);
          });
          const { container: ha, outside: ka, renderer: ja } = b;
          if (ka && ha && ja) {
            const { width: b, height: c, x: e, y: a } = X.getBBox();
            ja.setSize(b + e, c + a, !1);
            ha.style.left = ba + 'px';
            ha.style.top = C + 'px';
          }
          B && X.attr({ opacity: 1 === X.opacity ? 0.999 : 1 });
        }
        drawTracker() {
          if (this.shouldStickOnContact()) {
            var a = this.chart,
              f = this.label,
              e = this.shared ? a.hoverPoints : a.hoverPoint;
            if (f && e) {
              var b = { x: 0, y: 0, width: 0, height: 0 };
              e = this.getAnchor(e);
              var c = f.getBBox();
              e[0] += a.plotLeft - f.translateX;
              e[1] += a.plotTop - f.translateY;
              b.x = Math.min(0, e[0]);
              b.y = Math.min(0, e[1]);
              b.width =
                0 > e[0]
                  ? Math.max(Math.abs(e[0]), c.width - e[0])
                  : Math.max(Math.abs(e[0]), c.width);
              b.height =
                0 > e[1]
                  ? Math.max(Math.abs(e[1]), c.height - Math.abs(e[1]))
                  : Math.max(Math.abs(e[1]), c.height);
              this.tracker
                ? this.tracker.attr(b)
                : ((this.tracker = f.renderer
                    .rect(b)
                    .addClass('highcharts-tracker')
                    .add(f)),
                  a.styledMode || this.tracker.attr({ fill: 'rgba(0,0,0,0)' }));
            }
          } else this.tracker && (this.tracker = this.tracker.destroy());
        }
        styledModeFormat(a) {
          return a
            .replace('style="font-size: 0.8em"', 'class="highcharts-header"')
            .replace(
              /style="color:{(point|series)\.color}"/g,
              'class="highcharts-color-{$1.colorIndex} {series.options.className} {point.options.className}"',
            );
        }
        tooltipFooterHeaderFormatter(a, f) {
          const e = a.series,
            b = e.tooltipOptions;
          var c = e.xAxis;
          const l = c && c.dateTime;
          c = { isFooter: f, labelConfig: a };
          let d = b.xDateFormat,
            p = b[f ? 'footerFormat' : 'headerFormat'];
          g(this, 'headerFormatter', c, function (c) {
            l &&
              !d &&
              k(a.key) &&
              (d = l.getXDateFormat(a.key, b.dateTimeLabelFormats));
            l &&
              d &&
              ((a.point && a.point.tooltipDateKeys) || ['key']).forEach(
                function (b) {
                  p = p.replace(
                    '{point.' + b + '}',
                    '{point.' + b + ':' + d + '}',
                  );
                },
              );
            e.chart.styledMode && (p = this.styledModeFormat(p));
            c.text = x(p, { point: a, series: e }, this.chart);
          });
          return c.text;
        }
        update(a) {
          this.destroy();
          this.init(this.chart, K(!0, this.options, a));
        }
        updatePosition(a) {
          const { chart: f, distance: e, options: b } = this;
          var c = f.pointer;
          const l = this.getLabel(),
            { left: d, top: p, scaleX: n, scaleY: t } = c.getChartPosition();
          c = (b.positioner || this.getPosition).call(
            this,
            l.width,
            l.height,
            a,
          );
          let g = (a.plotX || 0) + f.plotLeft;
          a = (a.plotY || 0) + f.plotTop;
          let k;
          if (this.outside) {
            b.positioner && ((c.x += d - e), (c.y += p - e));
            k = (b.borderWidth || 0) + 2 * e;
            this.renderer.setSize(l.width + k, l.height + k, !1);
            if (1 !== n || 1 !== t)
              (m(this.container, { transform: `scale(${n}, ${t})` }),
                (g *= n),
                (a *= t));
            g += d - c.x;
            a += p - c.y;
          }
          this.move(Math.round(c.x), Math.round(c.y || 0), g, a);
        }
      }
      (function (a) {
        const f = [];
        a.compose = function (e) {
          C.pushUnique(f, e) &&
            q(e, 'afterInit', function () {
              const b = this.chart;
              b.options.tooltip && (b.tooltip = new a(b, b.options.tooltip));
            });
        };
      })(t || (t = {}));
      ('');
      return t;
    },
  );
  M(
    a,
    'Core/Series/Point.js',
    [
      a['Core/Renderer/HTML/AST.js'],
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Defaults.js'],
      a['Core/Templating.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C) {
      const { animObject: x } = A,
        { defaultOptions: D } = G,
        { format: B } = H,
        {
          addEvent: u,
          defined: q,
          erase: r,
          extend: m,
          fireEvent: v,
          getNestedProperty: h,
          isArray: g,
          isFunction: d,
          isNumber: k,
          isObject: y,
          merge: K,
          objectEach: L,
          pick: f,
          syncTimeout: p,
          removeEvent: t,
          uniqueKey: n,
        } = C;
      class w {
        constructor() {
          this.category = void 0;
          this.destroyed = !1;
          this.formatPrefix = 'point';
          this.id = void 0;
          this.isNull = !1;
          this.percentage = this.options = this.name = void 0;
          this.selected = !1;
          this.total = this.shapeArgs = this.series = void 0;
          this.visible = !0;
          this.x = void 0;
        }
        animateBeforeDestroy() {
          const e = this,
            b = { x: e.startXPos, opacity: 0 },
            c = e.getGraphicalProps();
          c.singular.forEach(function (c) {
            e[c] = e[c].animate(
              'dataLabel' === c
                ? { x: e[c].startXPos, y: e[c].startYPos, opacity: 0 }
                : b,
            );
          });
          c.plural.forEach(function (b) {
            e[b].forEach(function (b) {
              b.element &&
                b.animate(
                  m(
                    { x: e.startXPos },
                    b.startYPos ? { x: b.startXPos, y: b.startYPos } : {},
                  ),
                );
            });
          });
        }
        applyOptions(e, b) {
          const c = this.series,
            a = c.options.pointValKey || c.pointValKey;
          e = w.prototype.optionsToObject.call(this, e);
          m(this, e);
          this.options = this.options ? m(this.options, e) : e;
          e.group && delete this.group;
          e.dataLabels && delete this.dataLabels;
          a && (this.y = w.prototype.getNestedProperty.call(this, a));
          this.formatPrefix = (this.isNull = this.isValid && !this.isValid())
            ? 'null'
            : 'point';
          this.selected && (this.state = 'select');
          'name' in this &&
            'undefined' === typeof b &&
            c.xAxis &&
            c.xAxis.hasNames &&
            (this.x = c.xAxis.nameToX(this));
          'undefined' === typeof this.x && c
            ? (this.x = 'undefined' === typeof b ? c.autoIncrement() : b)
            : k(e.x) &&
              c.options.relativeXValue &&
              (this.x = c.autoIncrement(e.x));
          return this;
        }
        destroy() {
          if (!this.destroyed) {
            const b = this;
            var e = b.series;
            const c = e.chart;
            e = e.options.dataSorting;
            const a = c.hoverPoints,
              f = x(b.series.chart.renderer.globalAnimation),
              d = () => {
                if (b.graphic || b.graphics || b.dataLabel || b.dataLabels)
                  (t(b), b.destroyElements());
                for (const c in b) delete b[c];
              };
            b.legendItem && c.legend.destroyItem(b);
            a && (b.setState(), r(a, b), a.length || (c.hoverPoints = null));
            if (b === c.hoverPoint) b.onMouseOut();
            e && e.enabled
              ? (this.animateBeforeDestroy(), p(d, f.duration))
              : d();
            c.pointCount--;
          }
          this.destroyed = !0;
        }
        destroyElements(e) {
          const b = this;
          e = b.getGraphicalProps(e);
          e.singular.forEach(function (c) {
            b[c] = b[c].destroy();
          });
          e.plural.forEach(function (c) {
            b[c].forEach(function (b) {
              b && b.element && b.destroy();
            });
            delete b[c];
          });
        }
        firePointEvent(e, b, c) {
          const a = this,
            f = this.series.options;
          (f.point.events[e] ||
            (a.options && a.options.events && a.options.events[e])) &&
            a.importEvents();
          'click' === e &&
            f.allowPointSelect &&
            (c = function (b) {
              !a.destroyed &&
                a.select &&
                a.select(null, b.ctrlKey || b.metaKey || b.shiftKey);
            });
          v(a, e, b, c);
        }
        getClassName() {
          return (
            'highcharts-point' +
            (this.selected ? ' highcharts-point-select' : '') +
            (this.negative ? ' highcharts-negative' : '') +
            (this.isNull ? ' highcharts-null-point' : '') +
            ('undefined' !== typeof this.colorIndex
              ? ' highcharts-color-' + this.colorIndex
              : '') +
            (this.options.className ? ' ' + this.options.className : '') +
            (this.zone && this.zone.className
              ? ' ' + this.zone.className.replace('highcharts-negative', '')
              : '')
          );
        }
        getGraphicalProps(e) {
          const b = this,
            c = [],
            a = { singular: [], plural: [] };
          let f, d;
          e = e || { graphic: 1, dataLabel: 1 };
          e.graphic && c.push('graphic');
          e.dataLabel &&
            c.push('dataLabel', 'dataLabelPath', 'dataLabelUpper', 'connector');
          for (d = c.length; d--; ) ((f = c[d]), b[f] && a.singular.push(f));
          ['graphic', 'dataLabel', 'connector'].forEach(function (c) {
            const f = c + 's';
            e[c] && b[f] && a.plural.push(f);
          });
          return a;
        }
        getLabelConfig() {
          return {
            x: this.category,
            y: this.y,
            color: this.color,
            colorIndex: this.colorIndex,
            key: this.name || this.category,
            series: this.series,
            point: this,
            percentage: this.percentage,
            total: this.total || this.stackTotal,
          };
        }
        getNestedProperty(e) {
          if (e)
            return 0 === e.indexOf('custom.') ? h(e, this.options) : this[e];
        }
        getZone() {
          var e = this.series;
          const b = e.zones;
          e = e.zoneAxis || 'y';
          let c,
            a = 0;
          for (c = b[a]; this[e] >= c.value; ) c = b[++a];
          this.nonZonedColor || (this.nonZonedColor = this.color);
          this.color =
            c && c.color && !this.options.color ? c.color : this.nonZonedColor;
          return c;
        }
        hasNewShapeType() {
          return (
            (this.graphic &&
              (this.graphic.symbolName || this.graphic.element.nodeName)) !==
            this.shapeType
          );
        }
        init(e, b, c) {
          this.series = e;
          this.applyOptions(b, c);
          this.id = q(this.id) ? this.id : n();
          this.resolveColor();
          e.chart.pointCount++;
          v(this, 'afterInit');
          return this;
        }
        isValid() {
          return null !== this.x && k(this.y);
        }
        optionsToObject(e) {
          var b = this.series;
          const c = b.options.keys,
            a = c || b.pointArrayMap || ['y'],
            f = a.length;
          let d = {},
            p = 0,
            n = 0;
          if (k(e) || null === e) d[a[0]] = e;
          else if (g(e))
            for (
              !c &&
              e.length > f &&
              ((b = typeof e[0]),
              'string' === b ? (d.name = e[0]) : 'number' === b && (d.x = e[0]),
              p++);
              n < f;
            )
              ((c && 'undefined' === typeof e[p]) ||
                (0 < a[n].indexOf('.')
                  ? w.prototype.setNestedProperty(d, e[p], a[n])
                  : (d[a[n]] = e[p])),
                p++,
                n++);
          else
            'object' === typeof e &&
              ((d = e),
              e.dataLabels && (b._hasPointLabels = !0),
              e.marker && (b._hasPointMarkers = !0));
          return d;
        }
        pos(e, b = this.plotY) {
          if (!this.destroyed) {
            const { plotX: c, series: a } = this,
              { chart: f, xAxis: d, yAxis: p } = a;
            let n = 0,
              t = 0;
            if (k(c) && k(b))
              return (
                e &&
                  ((n = d ? d.pos : f.plotLeft), (t = p ? p.pos : f.plotTop)),
                f.inverted && d && p
                  ? [p.len - b + t, d.len - c + n]
                  : [c + n, b + t]
              );
          }
        }
        resolveColor() {
          const e = this.series;
          var b = e.chart.styledMode;
          let c;
          var a = e.chart.options.chart.colorCount;
          delete this.nonZonedColor;
          e.options.colorByPoint
            ? (b ||
                ((a = e.options.colors || e.chart.options.colors),
                (c = a[e.colorCounter]),
                (a = a.length)),
              (b = e.colorCounter),
              e.colorCounter++,
              e.colorCounter === a && (e.colorCounter = 0))
            : (b || (c = e.color), (b = e.colorIndex));
          this.colorIndex = f(this.options.colorIndex, b);
          this.color = f(this.options.color, c);
        }
        setNestedProperty(e, b, c) {
          c.split('.').reduce(function (c, e, a, f) {
            c[e] = f.length - 1 === a ? b : y(c[e], !0) ? c[e] : {};
            return c[e];
          }, e);
          return e;
        }
        shouldDraw() {
          return !this.isNull;
        }
        tooltipFormatter(e) {
          const b = this.series,
            c = b.tooltipOptions,
            a = f(c.valueDecimals, ''),
            d = c.valuePrefix || '',
            p = c.valueSuffix || '';
          b.chart.styledMode && (e = b.chart.tooltip.styledModeFormat(e));
          (b.pointArrayMap || ['y']).forEach(function (b) {
            b = '{point.' + b;
            if (d || p) e = e.replace(RegExp(b + '}', 'g'), d + b + '}' + p);
            e = e.replace(RegExp(b + '}', 'g'), b + ':,.' + a + 'f}');
          });
          return B(e, { point: this, series: this.series }, b.chart);
        }
        update(e, b, c, a) {
          function l() {
            d.applyOptions(e);
            var a = n && d.hasMockGraphic;
            a = null === d.y ? !a : a;
            n && a && ((d.graphic = n.destroy()), delete d.hasMockGraphic);
            y(e, !0) &&
              (n &&
                n.element &&
                e &&
                e.marker &&
                'undefined' !== typeof e.marker.symbol &&
                (d.graphic = n.destroy()),
              e &&
                e.dataLabels &&
                d.dataLabel &&
                (d.dataLabel = d.dataLabel.destroy()),
              d.connector && (d.connector = d.connector.destroy()));
            k = d.index;
            p.updateParallelArrays(d, k);
            g.data[k] =
              y(g.data[k], !0) || y(e, !0) ? d.options : f(e, g.data[k]);
            p.isDirty = p.isDirtyData = !0;
            !p.fixedBox && p.hasCartesianSeries && (t.isDirtyBox = !0);
            'point' === g.legendType && (t.isDirtyLegend = !0);
            b && t.redraw(c);
          }
          const d = this,
            p = d.series,
            n = d.graphic,
            t = p.chart,
            g = p.options;
          let k;
          b = f(b, !0);
          !1 === a ? l() : d.firePointEvent('update', { options: e }, l);
        }
        remove(e, b) {
          this.series.removePoint(this.series.data.indexOf(this), e, b);
        }
        select(e, b) {
          const c = this,
            a = c.series,
            d = a.chart;
          this.selectedStaging = e = f(e, !c.selected);
          c.firePointEvent(
            e ? 'select' : 'unselect',
            { accumulate: b },
            function () {
              c.selected = c.options.selected = e;
              a.options.data[a.data.indexOf(c)] = c.options;
              c.setState(e && 'select');
              b ||
                d.getSelectedPoints().forEach(function (b) {
                  const e = b.series;
                  b.selected &&
                    b !== c &&
                    ((b.selected = b.options.selected = !1),
                    (e.options.data[e.data.indexOf(b)] = b.options),
                    b.setState(
                      d.hoverPoints && e.options.inactiveOtherPoints
                        ? 'inactive'
                        : '',
                    ),
                    b.firePointEvent('unselect'));
                });
            },
          );
          delete this.selectedStaging;
        }
        onMouseOver(e) {
          const b = this.series.chart,
            c = b.pointer;
          e = e
            ? c.normalize(e)
            : c.getChartCoordinatesFromPoint(this, b.inverted);
          c.runPointActions(e, this);
        }
        onMouseOut() {
          const e = this.series.chart;
          this.firePointEvent('mouseOut');
          this.series.options.inactiveOtherPoints ||
            (e.hoverPoints || []).forEach(function (b) {
              b.setState();
            });
          e.hoverPoints = e.hoverPoint = null;
        }
        importEvents() {
          if (!this.hasImportedEvents) {
            const e = this,
              b = K(e.series.options.point, e.options).events;
            e.events = b;
            L(b, function (b, a) {
              d(b) && u(e, a, b);
            });
            this.hasImportedEvents = !0;
          }
        }
        setState(e, b) {
          const c = this.series;
          var l = this.state,
            d = c.options.states[e || 'normal'] || {},
            p = D.plotOptions[c.type].marker && c.options.marker;
          const n = p && !1 === p.enabled,
            t = (p && p.states && p.states[e || 'normal']) || {},
            g = !1 === t.enabled,
            w = this.marker || {},
            h = c.chart,
            q = p && c.markerAttribs;
          let r = c.halo;
          var y;
          let u;
          var K = c.stateMarkerGraphic;
          e = e || '';
          if (
            !(
              (e === this.state && !b) ||
              (this.selected && 'select' !== e) ||
              !1 === d.enabled ||
              (e && (g || (n && !1 === t.enabled))) ||
              (e && w.states && w.states[e] && !1 === w.states[e].enabled)
            )
          ) {
            this.state = e;
            q && (y = c.markerAttribs(this, e));
            if (this.graphic && !this.hasMockGraphic) {
              l && this.graphic.removeClass('highcharts-point-' + l);
              e && this.graphic.addClass('highcharts-point-' + e);
              if (!h.styledMode) {
                l = c.pointAttribs(this, e);
                u = f(h.options.chart.animation, d.animation);
                const b = l.opacity;
                c.options.inactiveOtherPoints &&
                  k(b) &&
                  ((this.dataLabels || []).forEach(function (c) {
                    c &&
                      !c.hasClass('highcharts-data-label-hidden') &&
                      c.animate({ opacity: b }, u);
                  }),
                  this.connector && this.connector.animate({ opacity: b }, u));
                this.graphic.animate(l, u);
              }
              y &&
                this.graphic.animate(
                  y,
                  f(h.options.chart.animation, t.animation, p.animation),
                );
              K && K.hide();
            } else {
              if (e && t) {
                p = w.symbol || c.symbol;
                K && K.currentSymbol !== p && (K = K.destroy());
                if (y)
                  if (K) K[b ? 'animate' : 'attr']({ x: y.x, y: y.y });
                  else
                    p &&
                      ((c.stateMarkerGraphic = K =
                        h.renderer
                          .symbol(p, y.x, y.y, y.width, y.height)
                          .add(c.markerGroup)),
                      (K.currentSymbol = p));
                !h.styledMode &&
                  K &&
                  'inactive' !== this.state &&
                  K.attr(c.pointAttribs(this, e));
              }
              K &&
                (K[e && this.isInside ? 'show' : 'hide'](),
                (K.element.point = this),
                K.addClass(this.getClassName(), !0));
            }
            d = d.halo;
            y = ((K = this.graphic || K) && K.visibility) || 'inherit';
            d && d.size && K && 'hidden' !== y && !this.isCluster
              ? (r || (c.halo = r = h.renderer.path().add(K.parentGroup)),
                r.show()[b ? 'animate' : 'attr']({ d: this.haloPath(d.size) }),
                r.attr({
                  class:
                    'highcharts-halo highcharts-color-' +
                    f(this.colorIndex, c.colorIndex) +
                    (this.className ? ' ' + this.className : ''),
                  visibility: y,
                  zIndex: -1,
                }),
                (r.point = this),
                h.styledMode ||
                  r.attr(
                    m(
                      {
                        fill: this.color || c.color,
                        'fill-opacity': d.opacity,
                      },
                      a.filterUserAttributes(d.attributes || {}),
                    ),
                  ))
              : r &&
                r.point &&
                r.point.haloPath &&
                r.animate({ d: r.point.haloPath(0) }, null, r.hide);
            v(this, 'afterSetState', { state: e });
          }
        }
        haloPath(e) {
          const b = this.pos();
          return b
            ? this.series.chart.renderer.symbols.circle(
                Math.floor(b[0]) - e,
                b[1] - e,
                2 * e,
                2 * e,
              )
            : [];
        }
      }
      ('');
      return w;
    },
  );
  M(
    a,
    'Core/Pointer.js',
    [a['Core/Color/Color.js'], a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      const { parse: x } = a,
        { charts: C, noop: z } = A,
        {
          addEvent: D,
          attr: B,
          css: u,
          defined: q,
          extend: r,
          find: m,
          fireEvent: v,
          isNumber: h,
          isObject: g,
          objectEach: d,
          offset: k,
          pick: y,
          splat: K,
        } = G;
      class L {
        constructor(a, d) {
          this.lastValidTouch = {};
          this.pinchDown = [];
          this.runChartClick = !1;
          this.eventsToUnbind = [];
          this.chart = a;
          this.hasDragged = !1;
          this.options = d;
          this.init(a, d);
        }
        applyInactiveState(a) {
          let f = [],
            d;
          (a || []).forEach(function (a) {
            d = a.series;
            f.push(d);
            d.linkedParent && f.push(d.linkedParent);
            d.linkedSeries && (f = f.concat(d.linkedSeries));
            d.navigatorSeries && f.push(d.navigatorSeries);
          });
          this.chart.series.forEach(function (a) {
            -1 === f.indexOf(a)
              ? a.setState('inactive', !0)
              : a.options.inactiveOtherPoints &&
                a.setAllPointsToState('inactive');
          });
        }
        destroy() {
          const a = this;
          this.eventsToUnbind.forEach((a) => a());
          this.eventsToUnbind = [];
          A.chartCount ||
            (L.unbindDocumentMouseUp &&
              (L.unbindDocumentMouseUp = L.unbindDocumentMouseUp()),
            L.unbindDocumentTouchEnd &&
              (L.unbindDocumentTouchEnd = L.unbindDocumentTouchEnd()));
          clearInterval(a.tooltipTimeout);
          d(a, function (f, d) {
            a[d] = void 0;
          });
        }
        getSelectionMarkerAttrs(a, d) {
          const f = {
            args: { chartX: a, chartY: d },
            attrs: {},
            shapeType: 'rect',
          };
          v(this, 'getSelectionMarkerAttrs', f, (f) => {
            const {
              chart: p,
              mouseDownX: e = 0,
              mouseDownY: b = 0,
              zoomHor: c,
              zoomVert: l,
            } = this;
            f = f.attrs;
            let n;
            f.x = p.plotLeft;
            f.y = p.plotTop;
            f.width = c ? 1 : p.plotWidth;
            f.height = l ? 1 : p.plotHeight;
            c &&
              ((n = a - e),
              (f.width = Math.abs(n)),
              (f.x = (0 < n ? 0 : n) + e));
            l &&
              ((n = d - b),
              (f.height = Math.abs(n)),
              (f.y = (0 < n ? 0 : n) + b));
          });
          return f;
        }
        drag(a) {
          const f = this.chart,
            d = f.options.chart;
          var n = f.plotLeft;
          const k = f.plotTop,
            e = f.plotWidth,
            b = f.plotHeight,
            c = this.mouseDownX || 0,
            l = this.mouseDownY || 0,
            h = g(d.panning) ? d.panning && d.panning.enabled : d.panning,
            m = d.panKey && a[d.panKey + 'Key'];
          let q = a.chartX,
            v = a.chartY,
            r = this.selectionMarker;
          if (!r || !r.touch)
            if (
              (q < n ? (q = n) : q > n + e && (q = n + e),
              v < k ? (v = k) : v > k + b && (v = k + b),
              (this.hasDragged = Math.sqrt(
                Math.pow(c - q, 2) + Math.pow(l - v, 2),
              )),
              10 < this.hasDragged)
            ) {
              n = f.isInsidePlot(c - n, l - k, { visiblePlotOnly: !0 });
              const { shapeType: b, attrs: e } = this.getSelectionMarkerAttrs(
                q,
                v,
              );
              (!f.hasCartesianSeries && !f.mapView) ||
                (!this.zoomX && !this.zoomY) ||
                !n ||
                m ||
                r ||
                ((this.selectionMarker = r = f.renderer[b]()),
                r
                  .attr({ class: 'highcharts-selection-marker', zIndex: 7 })
                  .add(),
                f.styledMode ||
                  r.attr({
                    fill:
                      d.selectionMarkerFill ||
                      x('#334eff').setOpacity(0.25).get(),
                  }));
              r && r.attr(e);
              n && !r && h && f.pan(a, d.panning);
            }
        }
        dragStart(a) {
          const f = this.chart;
          f.mouseIsDown = a.type;
          f.cancelClick = !1;
          f.mouseDownX = this.mouseDownX = a.chartX;
          f.mouseDownY = this.mouseDownY = a.chartY;
        }
        getSelectionBox(a) {
          const f = { args: { marker: a }, result: {} };
          v(this, 'getSelectionBox', f, (f) => {
            f.result = {
              x: a.attr ? +a.attr('x') : a.x,
              y: a.attr ? +a.attr('y') : a.y,
              width: a.attr ? a.attr('width') : a.width,
              height: a.attr ? a.attr('height') : a.height,
            };
          });
          return f.result;
        }
        drop(a) {
          const f = this,
            d = this.chart,
            n = this.hasPinched;
          if (this.selectionMarker) {
            const {
                x: p,
                y: e,
                width: b,
                height: c,
              } = this.getSelectionBox(this.selectionMarker),
              l = {
                originalEvent: a,
                xAxis: [],
                yAxis: [],
                x: p,
                y: e,
                width: b,
                height: c,
              };
            let t = !!d.mapView;
            if (this.hasDragged || n)
              (d.axes.forEach(function (d) {
                if (
                  d.zoomEnabled &&
                  q(d.min) &&
                  (n || f[{ xAxis: 'zoomX', yAxis: 'zoomY' }[d.coll]]) &&
                  h(p) &&
                  h(e) &&
                  h(b) &&
                  h(c)
                ) {
                  var g = d.horiz;
                  const f = 'touchend' === a.type ? d.minPixelPadding : 0,
                    n = d.toValue((g ? p : e) + f);
                  g = d.toValue((g ? p + b : e + c) - f);
                  l[d.coll].push({
                    axis: d,
                    min: Math.min(n, g),
                    max: Math.max(n, g),
                  });
                  t = !0;
                }
              }),
                t &&
                  v(d, 'selection', l, function (b) {
                    d.zoom(r(b, n ? { animation: !1 } : null));
                  }));
            h(d.index) &&
              (this.selectionMarker = this.selectionMarker.destroy());
            n && this.scaleGroups();
          }
          d &&
            h(d.index) &&
            (u(d.container, { cursor: d._cursor }),
            (d.cancelClick = 10 < this.hasDragged),
            (d.mouseIsDown = this.hasDragged = this.hasPinched = !1),
            (this.pinchDown = []));
        }
        findNearestKDPoint(a, d, t) {
          let f;
          a.forEach(function (a) {
            var e =
              !(a.noSharedTooltip && d) &&
              0 > a.options.findNearestPointBy.indexOf('y');
            a = a.searchPoint(t, e);
            if ((e = g(a, !0) && a.series) && !(e = !g(f, !0))) {
              {
                e = f.distX - a.distX;
                const b = f.dist - a.dist,
                  c =
                    (a.series.group && a.series.group.zIndex) -
                    (f.series.group && f.series.group.zIndex);
                e =
                  0 !== e && d
                    ? e
                    : 0 !== b
                      ? b
                      : 0 !== c
                        ? c
                        : f.series.index > a.series.index
                          ? -1
                          : 1;
              }
              e = 0 < e;
            }
            e && (f = a);
          });
          return f;
        }
        getChartCoordinatesFromPoint(a, d) {
          var f = a.series;
          const p = f.xAxis;
          f = f.yAxis;
          const g = a.shapeArgs;
          if (p && f) {
            let e = y(a.clientX, a.plotX),
              b = a.plotY || 0;
            a.isNode && g && h(g.x) && h(g.y) && ((e = g.x), (b = g.y));
            return d
              ? { chartX: f.len + f.pos - b, chartY: p.len + p.pos - e }
              : { chartX: e + p.pos, chartY: b + f.pos };
          }
          if (g && g.x && g.y) return { chartX: g.x, chartY: g.y };
        }
        getChartPosition() {
          if (this.chartPosition) return this.chartPosition;
          var { container: a } = this.chart;
          const d = k(a);
          this.chartPosition = {
            left: d.left,
            top: d.top,
            scaleX: 1,
            scaleY: 1,
          };
          const t = a.offsetWidth;
          a = a.offsetHeight;
          2 < t &&
            2 < a &&
            ((this.chartPosition.scaleX = d.width / t),
            (this.chartPosition.scaleY = d.height / a));
          return this.chartPosition;
        }
        getCoordinates(a) {
          const f = { xAxis: [], yAxis: [] };
          this.chart.axes.forEach(function (d) {
            f[d.isXAxis ? 'xAxis' : 'yAxis'].push({
              axis: d,
              value: d.toValue(a[d.horiz ? 'chartX' : 'chartY']),
            });
          });
          return f;
        }
        getHoverData(a, d, t, n, k, e) {
          const b = [];
          n = !(!n || !a);
          const c = function (b) {
            return (
              b.visible &&
              !(!k && b.directTouch) &&
              y(b.options.enableMouseTracking, !0)
            );
          };
          let f,
            p = {
              chartX: e ? e.chartX : void 0,
              chartY: e ? e.chartY : void 0,
              shared: k,
            };
          v(this, 'beforeGetHoverData', p);
          f =
            d && !d.stickyTracking
              ? [d]
              : t.filter((b) => b.stickyTracking && (p.filter || c)(b));
          const h = n || !e ? a : this.findNearestKDPoint(f, k, e);
          d = h && h.series;
          h &&
            (k && !d.noSharedTooltip
              ? ((f = t.filter(function (b) {
                  return p.filter ? p.filter(b) : c(b) && !b.noSharedTooltip;
                })),
                f.forEach(function (c) {
                  let e = m(c.points, function (b) {
                    return b.x === h.x && !b.isNull;
                  });
                  g(e) &&
                    (c.boosted && c.boost && (e = c.boost.getPoint(e)),
                    b.push(e));
                }))
              : b.push(h));
          p = { hoverPoint: h };
          v(this, 'afterGetHoverData', p);
          return { hoverPoint: p.hoverPoint, hoverSeries: d, hoverPoints: b };
        }
        getPointFromEvent(a) {
          a = a.target;
          let f;
          for (; a && !f; ) ((f = a.point), (a = a.parentNode));
          return f;
        }
        onTrackerMouseOut(a) {
          a = a.relatedTarget;
          const f = this.chart.hoverSeries;
          this.isDirectTouch = !1;
          if (
            !(
              !f ||
              !a ||
              f.stickyTracking ||
              this.inClass(a, 'highcharts-tooltip') ||
              (this.inClass(a, 'highcharts-series-' + f.index) &&
                this.inClass(a, 'highcharts-tracker'))
            )
          )
            f.onMouseOut();
        }
        inClass(a, d) {
          let f;
          for (; a; ) {
            if ((f = B(a, 'class'))) {
              if (-1 !== f.indexOf(d)) return !0;
              if (-1 !== f.indexOf('highcharts-container')) return !1;
            }
            a = a.parentElement;
          }
        }
        init(a, d) {
          this.options = d;
          this.chart = a;
          this.runChartClick = !(!d.chart.events || !d.chart.events.click);
          this.pinchDown = [];
          this.lastValidTouch = {};
          this.setDOMEvents();
          v(this, 'afterInit');
        }
        normalize(a, d) {
          var f = a.touches,
            p = f
              ? f.length
                ? f.item(0)
                : y(f.changedTouches, a.changedTouches)[0]
              : a;
          d || (d = this.getChartPosition());
          f = p.pageX - d.left;
          p = p.pageY - d.top;
          f /= d.scaleX;
          p /= d.scaleY;
          return r(a, { chartX: Math.round(f), chartY: Math.round(p) });
        }
        onContainerClick(a) {
          const f = this.chart,
            d = f.hoverPoint;
          a = this.normalize(a);
          const n = f.plotLeft,
            g = f.plotTop;
          f.cancelClick ||
            (d && this.inClass(a.target, 'highcharts-tracker')
              ? (v(d.series, 'click', r(a, { point: d })),
                f.hoverPoint && d.firePointEvent('click', a))
              : (r(a, this.getCoordinates(a)),
                f.isInsidePlot(a.chartX - n, a.chartY - g, {
                  visiblePlotOnly: !0,
                }) && v(f, 'click', a)));
        }
        onContainerMouseDown(a) {
          const f = 1 === ((a.buttons || a.button) & 1);
          a = this.normalize(a);
          if (A.isFirefox && 0 !== a.button) this.onContainerMouseMove(a);
          if ('undefined' === typeof a.button || f)
            (this.zoomOption(a),
              f && a.preventDefault && a.preventDefault(),
              this.dragStart(a));
        }
        onContainerMouseLeave(a) {
          const f = C[y(L.hoverChartIndex, -1)];
          a = this.normalize(a);
          f &&
            a.relatedTarget &&
            !this.inClass(a.relatedTarget, 'highcharts-tooltip') &&
            (f.pointer.reset(), (f.pointer.chartPosition = void 0));
        }
        onContainerMouseEnter(a) {
          delete this.chartPosition;
        }
        onContainerMouseMove(a) {
          const f = this.chart,
            d = f.tooltip;
          a = this.normalize(a);
          this.setHoverChartIndex();
          ('mousedown' === f.mouseIsDown || this.touchSelect(a)) &&
            this.drag(a);
          f.openMenu ||
            (!this.inClass(a.target, 'highcharts-tracker') &&
              !f.isInsidePlot(a.chartX - f.plotLeft, a.chartY - f.plotTop, {
                visiblePlotOnly: !0,
              })) ||
            (d && d.shouldStickOnContact(a)) ||
            (this.inClass(a.target, 'highcharts-no-tooltip')
              ? this.reset(!1, 0)
              : this.runPointActions(a));
        }
        onDocumentTouchEnd(a) {
          const f = C[y(L.hoverChartIndex, -1)];
          f && f.pointer.drop(a);
        }
        onContainerTouchMove(a) {
          if (this.touchSelect(a)) this.onContainerMouseMove(a);
          else this.touch(a);
        }
        onContainerTouchStart(a) {
          if (this.touchSelect(a)) this.onContainerMouseDown(a);
          else (this.zoomOption(a), this.touch(a, !0));
        }
        onDocumentMouseMove(a) {
          const f = this.chart,
            d = f.tooltip,
            n = this.chartPosition;
          a = this.normalize(a, n);
          !n ||
            f.isInsidePlot(a.chartX - f.plotLeft, a.chartY - f.plotTop, {
              visiblePlotOnly: !0,
            }) ||
            (d && d.shouldStickOnContact(a)) ||
            this.inClass(a.target, 'highcharts-tracker') ||
            this.reset();
        }
        onDocumentMouseUp(a) {
          const f = C[y(L.hoverChartIndex, -1)];
          f && f.pointer.drop(a);
        }
        pinch(a) {
          const f = this,
            d = f.chart,
            n = f.pinchDown,
            g = a.touches || [],
            e = g.length,
            b = f.lastValidTouch,
            c = f.hasZoom,
            l = {},
            k =
              1 === e &&
              ((f.inClass(a.target, 'highcharts-tracker') &&
                d.runTrackerClick) ||
                f.runChartClick),
            h = {};
          var m = f.chart.tooltip;
          m = 1 === e && y(m && m.options.followTouchMove, !0);
          let q = f.selectionMarker;
          1 < e ? (f.initiated = !0) : m && (f.initiated = !1);
          c && f.initiated && !k && !1 !== a.cancelable && a.preventDefault();
          [].map.call(g, function (b) {
            return f.normalize(b);
          });
          'touchstart' === a.type
            ? ([].forEach.call(g, function (b, c) {
                n[c] = { chartX: b.chartX, chartY: b.chartY };
              }),
              (b.x = [n[0].chartX, n[1] && n[1].chartX]),
              (b.y = [n[0].chartY, n[1] && n[1].chartY]),
              d.axes.forEach(function (b) {
                if (b.zoomEnabled) {
                  const c = d.bounds[b.horiz ? 'h' : 'v'],
                    e = b.minPixelPadding,
                    a = b.toPixels(
                      Math.min(y(b.options.min, b.dataMin), b.dataMin),
                    ),
                    f = b.toPixels(
                      Math.max(y(b.options.max, b.dataMax), b.dataMax),
                    ),
                    l = Math.max(a, f);
                  c.min = Math.min(b.pos, Math.min(a, f) - e);
                  c.max = Math.max(b.pos + b.len, l + e);
                }
              }),
              (f.res = !0))
            : m
              ? this.runPointActions(f.normalize(a))
              : n.length &&
                (v(d, 'touchpan', { originalEvent: a }, () => {
                  q ||
                    (f.selectionMarker = q =
                      r({ destroy: z, touch: !0 }, d.plotBox));
                  f.pinchTranslate(n, g, l, q, h, b);
                  f.hasPinched = c;
                  f.scaleGroups(l, h);
                }),
                f.res && ((f.res = !1), this.reset(!1, 0)));
        }
        pinchTranslate(a, d, g, n, k, e) {
          this.zoomHor && this.pinchTranslateDirection(!0, a, d, g, n, k, e);
          this.zoomVert && this.pinchTranslateDirection(!1, a, d, g, n, k, e);
        }
        pinchTranslateDirection(a, d, g, n, k, e, b, c) {
          const f = this.chart,
            p = a ? 'x' : 'y',
            t = a ? 'X' : 'Y',
            h = 'chart' + t,
            w = a ? 'width' : 'height',
            m = f['plot' + (a ? 'Left' : 'Top')],
            q = f.inverted,
            v = f.bounds[a ? 'h' : 'v'],
            r = 1 === d.length,
            y = d[0][h],
            u = !r && d[1][h];
          d = function () {
            'number' === typeof X &&
              20 < Math.abs(y - u) &&
              (x = c || Math.abs(N - X) / Math.abs(y - u));
            L = (m - N) / x + y;
            K = f['plot' + (a ? 'Width' : 'Height')] / x;
          };
          let K,
            L,
            x = c || 1,
            N = g[0][h],
            X = !r && g[1][h],
            R;
          d();
          g = L;
          g < v.min
            ? ((g = v.min), (R = !0))
            : g + K > v.max && ((g = v.max - K), (R = !0));
          R
            ? ((N -= 0.8 * (N - b[p][0])),
              'number' === typeof X && (X -= 0.8 * (X - b[p][1])),
              d())
            : (b[p] = [N, X]);
          q || ((e[p] = L - m), (e[w] = K));
          e = q ? 1 / x : x;
          k[w] = K;
          k[p] = g;
          n[q ? (a ? 'scaleY' : 'scaleX') : 'scale' + t] = x;
          n['translate' + t] = e * m + (N - e * y);
        }
        reset(a, d) {
          const f = this.chart,
            n = f.hoverSeries,
            p = f.hoverPoint,
            e = f.hoverPoints,
            b = f.tooltip,
            c = b && b.shared ? e : p;
          a &&
            c &&
            K(c).forEach(function (b) {
              b.series.isCartesian &&
                'undefined' === typeof b.plotX &&
                (a = !1);
            });
          if (a)
            b &&
              c &&
              K(c).length &&
              (b.refresh(c),
              b.shared && e
                ? e.forEach(function (b) {
                    b.setState(b.state, !0);
                    b.series.isCartesian &&
                      (b.series.xAxis.crosshair &&
                        b.series.xAxis.drawCrosshair(null, b),
                      b.series.yAxis.crosshair &&
                        b.series.yAxis.drawCrosshair(null, b));
                  })
                : p &&
                  (p.setState(p.state, !0),
                  f.axes.forEach(function (b) {
                    b.crosshair &&
                      p.series[b.coll] === b &&
                      b.drawCrosshair(null, p);
                  })));
          else {
            if (p) p.onMouseOut();
            e &&
              e.forEach(function (b) {
                b.setState();
              });
            if (n) n.onMouseOut();
            b && b.hide(d);
            this.unDocMouseMove &&
              (this.unDocMouseMove = this.unDocMouseMove());
            f.axes.forEach(function (b) {
              b.hideCrosshair();
            });
            this.hoverX = f.hoverPoints = f.hoverPoint = null;
          }
        }
        runPointActions(a, d, g) {
          const f = this.chart,
            p = f.tooltip && f.tooltip.options.enabled ? f.tooltip : void 0,
            e = p ? p.shared : !1;
          let b = d || f.hoverPoint,
            c = (b && b.series) || f.hoverSeries;
          d = this.getHoverData(
            b,
            c,
            f.series,
            (!a || 'touchmove' !== a.type) &&
              (!!d || (c && c.directTouch && this.isDirectTouch)),
            e,
            a,
          );
          b = d.hoverPoint;
          c = d.hoverSeries;
          const l = d.hoverPoints;
          d = c && c.tooltipOptions.followPointer && !c.tooltipOptions.split;
          const t = e && c && !c.noSharedTooltip;
          if (b && (g || b !== f.hoverPoint || (p && p.isHidden))) {
            (f.hoverPoints || []).forEach(function (b) {
              -1 === l.indexOf(b) && b.setState();
            });
            if (f.hoverSeries !== c) c.onMouseOver();
            this.applyInactiveState(l);
            (l || []).forEach(function (b) {
              b.setState('hover');
            });
            f.hoverPoint && f.hoverPoint.firePointEvent('mouseOut');
            if (!b.series) return;
            f.hoverPoints = l;
            f.hoverPoint = b;
            b.firePointEvent('mouseOver', void 0, () => {
              p && b && p.refresh(t ? l : b, a);
            });
          } else
            d &&
              p &&
              !p.isHidden &&
              ((g = p.getAnchor([{}], a)),
              f.isInsidePlot(g[0], g[1], { visiblePlotOnly: !0 }) &&
                p.updatePosition({ plotX: g[0], plotY: g[1] }));
          this.unDocMouseMove ||
            ((this.unDocMouseMove = D(
              f.container.ownerDocument,
              'mousemove',
              function (b) {
                const c = C[L.hoverChartIndex];
                if (c) c.pointer.onDocumentMouseMove(b);
              },
            )),
            this.eventsToUnbind.push(this.unDocMouseMove));
          f.axes.forEach(function (b) {
            const c = y((b.crosshair || {}).snap, !0);
            let e;
            c &&
              (((e = f.hoverPoint) && e.series[b.coll] === b) ||
                (e = m(l, (c) => c.series && c.series[b.coll] === b)));
            e || !c ? b.drawCrosshair(a, e) : b.hideCrosshair();
          });
        }
        scaleGroups(a, d) {
          const f = this.chart;
          f.series.forEach(function (p) {
            const n = a || p.getPlotBox();
            p.group &&
              ((p.xAxis && p.xAxis.zoomEnabled) || f.mapView) &&
              (p.group.attr(n),
              p.markerGroup &&
                (p.markerGroup.attr(n),
                p.markerGroup.clip(d ? f.clipRect : null)),
              p.dataLabelsGroup && p.dataLabelsGroup.attr(n));
          });
          f.clipRect.attr(d || f.clipBox);
        }
        setDOMEvents() {
          const a = this.chart.container,
            d = a.ownerDocument;
          a.onmousedown = this.onContainerMouseDown.bind(this);
          a.onmousemove = this.onContainerMouseMove.bind(this);
          a.onclick = this.onContainerClick.bind(this);
          this.eventsToUnbind.push(
            D(a, 'mouseenter', this.onContainerMouseEnter.bind(this)),
          );
          this.eventsToUnbind.push(
            D(a, 'mouseleave', this.onContainerMouseLeave.bind(this)),
          );
          L.unbindDocumentMouseUp ||
            (L.unbindDocumentMouseUp = D(
              d,
              'mouseup',
              this.onDocumentMouseUp.bind(this),
            ));
          let g = this.chart.renderTo.parentElement;
          for (; g && 'BODY' !== g.tagName; )
            (this.eventsToUnbind.push(
              D(g, 'scroll', () => {
                delete this.chartPosition;
              }),
            ),
              (g = g.parentElement));
          A.hasTouch &&
            (this.eventsToUnbind.push(
              D(a, 'touchstart', this.onContainerTouchStart.bind(this), {
                passive: !1,
              }),
            ),
            this.eventsToUnbind.push(
              D(a, 'touchmove', this.onContainerTouchMove.bind(this), {
                passive: !1,
              }),
            ),
            L.unbindDocumentTouchEnd ||
              (L.unbindDocumentTouchEnd = D(
                d,
                'touchend',
                this.onDocumentTouchEnd.bind(this),
                { passive: !1 },
              )));
        }
        setHoverChartIndex() {
          const a = this.chart,
            d = A.charts[y(L.hoverChartIndex, -1)];
          if (d && d !== a)
            d.pointer.onContainerMouseLeave({ relatedTarget: a.container });
          (d && d.mouseIsDown) || (L.hoverChartIndex = a.index);
        }
        touch(a, d) {
          const f = this.chart;
          let p, g;
          this.setHoverChartIndex();
          1 === a.touches.length
            ? ((a = this.normalize(a)),
              (g = f.isInsidePlot(a.chartX - f.plotLeft, a.chartY - f.plotTop, {
                visiblePlotOnly: !0,
              })) && !f.openMenu
                ? (d && this.runPointActions(a),
                  'touchmove' === a.type &&
                    ((d = this.pinchDown),
                    (p = d[0]
                      ? 4 <=
                        Math.sqrt(
                          Math.pow(d[0].chartX - a.chartX, 2) +
                            Math.pow(d[0].chartY - a.chartY, 2),
                        )
                      : !1)),
                  y(p, !0) && this.pinch(a))
                : d && this.reset())
            : 2 === a.touches.length && this.pinch(a);
        }
        touchSelect(a) {
          return !(
            !this.chart.zooming.singleTouch ||
            !a.touches ||
            1 !== a.touches.length
          );
        }
        zoomOption(a) {
          const f = this.chart,
            d = f.inverted;
          var g = f.zooming.type || '';
          /touch/.test(a.type) && (g = y(f.zooming.pinchType, g));
          this.zoomX = a = /x/.test(g);
          this.zoomY = g = /y/.test(g);
          this.zoomHor = (a && !d) || (g && d);
          this.zoomVert = (g && !d) || (a && d);
          this.hasZoom = a || g;
        }
      }
      (function (a) {
        const f = [],
          d = [];
        a.compose = function (f) {
          G.pushUnique(d, f) &&
            D(f, 'beforeRender', function () {
              this.pointer = new a(this, this.options);
            });
        };
        a.dissolve = function () {
          for (let a = 0, d = f.length; a < d; ++a) f[a]();
          f.length = 0;
        };
      })(L || (L = {}));
      ('');
      return L;
    },
  );
  M(
    a,
    'Core/Legend/Legend.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Templating.js'],
      a['Core/Globals.js'],
      a['Core/Series/Point.js'],
      a['Core/Renderer/RendererUtilities.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z) {
      const { animObject: x, setAnimation: B } = a,
        { format: u } = A,
        { marginNames: q } = G,
        { distribute: r } = C,
        {
          addEvent: m,
          createElement: v,
          css: h,
          defined: g,
          discardElement: d,
          find: k,
          fireEvent: y,
          isNumber: K,
          merge: L,
          pick: f,
          relativeLength: p,
          stableSort: t,
          syncTimeout: n,
        } = z;
      class w {
        constructor(e, b) {
          this.allItems = [];
          this.contentGroup = this.box = void 0;
          this.display = !1;
          this.group = void 0;
          this.offsetWidth =
            this.maxLegendWidth =
            this.maxItemWidth =
            this.legendWidth =
            this.legendHeight =
            this.lastLineHeight =
            this.lastItemY =
            this.itemY =
            this.itemX =
            this.itemMarginTop =
            this.itemMarginBottom =
            this.itemHeight =
            this.initialItemY =
              0;
          this.options = void 0;
          this.padding = 0;
          this.pages = [];
          this.proximate = !1;
          this.scrollGroup = void 0;
          this.widthOption =
            this.totalItemWidth =
            this.titleHeight =
            this.symbolWidth =
            this.symbolHeight =
              0;
          this.chart = e;
          this.init(e, b);
        }
        init(e, b) {
          this.chart = e;
          this.setOptions(b);
          b.enabled &&
            (this.render(),
            m(this.chart, 'endResize', function () {
              this.legend.positionCheckboxes();
            }),
            m(this.chart, 'render', () => {
              this.proximate &&
                (this.proximatePositions(), this.positionItems());
            }));
        }
        setOptions(e) {
          const b = f(e.padding, 8);
          this.options = e;
          this.chart.styledMode ||
            ((this.itemStyle = e.itemStyle),
            (this.itemHiddenStyle = L(this.itemStyle, e.itemHiddenStyle)));
          this.itemMarginTop = e.itemMarginTop;
          this.itemMarginBottom = e.itemMarginBottom;
          this.padding = b;
          this.initialItemY = b - 5;
          this.symbolWidth = f(e.symbolWidth, 16);
          this.pages = [];
          this.proximate = 'proximate' === e.layout && !this.chart.inverted;
          this.baseline = void 0;
        }
        update(e, b) {
          const c = this.chart;
          this.setOptions(L(!0, this.options, e));
          this.destroy();
          c.isDirtyLegend = c.isDirtyBox = !0;
          f(b, !0) && c.redraw();
          y(this, 'afterUpdate');
        }
        colorizeItem(e, b) {
          const { group: c, label: a, line: f, symbol: d } = e.legendItem || {};
          if (c)
            c[b ? 'removeClass' : 'addClass']('highcharts-legend-item-hidden');
          if (!this.chart.styledMode) {
            const { itemHiddenStyle: c } = this,
              l = c.color,
              g = b ? e.color || l : l,
              p = e.options && e.options.marker;
            let n = { fill: g };
            null === a || void 0 === a
              ? void 0
              : a.css(L(b ? this.itemStyle : c));
            null === f || void 0 === f ? void 0 : f.attr({ stroke: g });
            d &&
              (p &&
                d.isMarker &&
                ((n = e.pointAttribs()), b || (n.stroke = n.fill = l)),
              d.attr(n));
          }
          y(this, 'afterColorizeItem', { item: e, visible: b });
        }
        positionItems() {
          this.allItems.forEach(this.positionItem, this);
          this.chart.isResizing || this.positionCheckboxes();
        }
        positionItem(e) {
          const { group: b, x: c = 0, y: a = 0 } = e.legendItem || {};
          var f = this.options,
            d = f.symbolPadding;
          const p = !f.rtl;
          f = e.checkbox;
          b &&
            b.element &&
            ((d = {
              translateX: p ? c : this.legendWidth - c - 2 * d - 4,
              translateY: a,
            }),
            b[g(b.translateY) ? 'animate' : 'attr'](d, void 0, () => {
              y(this, 'afterPositionItem', { item: e });
            }));
          f && ((f.x = c), (f.y = a));
        }
        destroyItem(a) {
          const b = a.checkbox,
            c = a.legendItem || {};
          for (const b of ['group', 'label', 'line', 'symbol'])
            c[b] && (c[b] = c[b].destroy());
          b && d(b);
          a.legendItem = void 0;
        }
        destroy() {
          for (const a of this.getAllItems()) this.destroyItem(a);
          for (const a of 'clipRect up down pager nav box title group'.split(
            ' ',
          ))
            this[a] && (this[a] = this[a].destroy());
          this.display = null;
        }
        positionCheckboxes() {
          const a = this.group && this.group.alignAttr,
            b = this.clipHeight || this.legendHeight,
            c = this.titleHeight;
          let f;
          a &&
            ((f = a.translateY),
            this.allItems.forEach(function (e) {
              const d = e.checkbox;
              let l;
              d &&
                ((l = f + c + d.y + (this.scrollOffset || 0) + 3),
                h(d, {
                  left: a.translateX + e.checkboxOffset + d.x - 20 + 'px',
                  top: l + 'px',
                  display:
                    this.proximate || (l > f - 6 && l < f + b - 6)
                      ? ''
                      : 'none',
                }));
            }, this));
        }
        renderTitle() {
          var a = this.options;
          const b = this.padding,
            c = a.title;
          let f = 0;
          c.text &&
            (this.title ||
              ((this.title = this.chart.renderer
                .label(
                  c.text,
                  b - 3,
                  b - 4,
                  void 0,
                  void 0,
                  void 0,
                  a.useHTML,
                  void 0,
                  'legend-title',
                )
                .attr({ zIndex: 1 })),
              this.chart.styledMode || this.title.css(c.style),
              this.title.add(this.group)),
            c.width || this.title.css({ width: this.maxLegendWidth + 'px' }),
            (a = this.title.getBBox()),
            (f = a.height),
            (this.offsetWidth = a.width),
            this.contentGroup.attr({ translateY: f }));
          this.titleHeight = f;
        }
        setText(a) {
          const b = this.options;
          a.legendItem.label.attr({
            text: b.labelFormat
              ? u(b.labelFormat, a, this.chart)
              : b.labelFormatter.call(a),
          });
        }
        renderItem(a) {
          const b = (a.legendItem = a.legendItem || {});
          var c = this.chart,
            e = c.renderer;
          const d = this.options,
            g = this.symbolWidth,
            p = d.symbolPadding || 0,
            n = this.itemStyle,
            k = this.itemHiddenStyle,
            t = 'horizontal' === d.layout ? f(d.itemDistance, 20) : 0,
            h = !d.rtl,
            w = !a.series,
            m = !w && a.series.drawLegendSymbol ? a.series : a;
          var q = m.options;
          const v = this.createCheckboxForItem && q && q.showCheckbox,
            r = d.useHTML,
            y = a.options.className;
          let N = b.label;
          q = g + p + t + (v ? 20 : 0);
          N ||
            ((b.group = e
              .g('legend-item')
              .addClass(
                'highcharts-' +
                  m.type +
                  '-series highcharts-color-' +
                  a.colorIndex +
                  (y ? ' ' + y : '') +
                  (w ? ' highcharts-series-' + a.index : ''),
              )
              .attr({ zIndex: 1 })
              .add(this.scrollGroup)),
            (b.label = N = e.text('', h ? g + p : -p, this.baseline || 0, r)),
            c.styledMode || N.css(L(a.visible ? n : k)),
            N.attr({ align: h ? 'left' : 'right', zIndex: 2 }).add(b.group),
            this.baseline ||
              ((this.fontMetrics = e.fontMetrics(N)),
              (this.baseline = this.fontMetrics.f + 3 + this.itemMarginTop),
              N.attr('y', this.baseline),
              (this.symbolHeight = f(d.symbolHeight, this.fontMetrics.f)),
              d.squareSymbol &&
                ((this.symbolWidth = f(
                  d.symbolWidth,
                  Math.max(this.symbolHeight, 16),
                )),
                (q = this.symbolWidth + p + t + (v ? 20 : 0)),
                h && N.attr('x', this.symbolWidth + p))),
            m.drawLegendSymbol(this, a),
            this.setItemEvents && this.setItemEvents(a, N, r));
          v &&
            !a.checkbox &&
            this.createCheckboxForItem &&
            this.createCheckboxForItem(a);
          this.colorizeItem(a, a.visible);
          (!c.styledMode && n.width) ||
            N.css({
              width:
                (d.itemWidth || this.widthOption || c.spacingBox.width) -
                q +
                'px',
            });
          this.setText(a);
          c = N.getBBox();
          e = (this.fontMetrics && this.fontMetrics.h) || 0;
          a.itemWidth = a.checkboxOffset =
            d.itemWidth || b.labelWidth || c.width + q;
          this.maxItemWidth = Math.max(this.maxItemWidth, a.itemWidth);
          this.totalItemWidth += a.itemWidth;
          this.itemHeight = a.itemHeight = Math.round(
            b.labelHeight || (c.height > 1.5 * e ? c.height : e),
          );
        }
        layoutItem(a) {
          var b = this.options;
          const c = this.padding,
            e = 'horizontal' === b.layout,
            d = a.itemHeight,
            g = this.itemMarginBottom,
            p = this.itemMarginTop,
            n = e ? f(b.itemDistance, 20) : 0,
            k = this.maxLegendWidth;
          b =
            b.alignColumns && this.totalItemWidth > k
              ? this.maxItemWidth
              : a.itemWidth;
          const t = a.legendItem || {};
          e &&
            this.itemX - c + b > k &&
            ((this.itemX = c),
            this.lastLineHeight && (this.itemY += p + this.lastLineHeight + g),
            (this.lastLineHeight = 0));
          this.lastItemY = p + this.itemY + g;
          this.lastLineHeight = Math.max(d, this.lastLineHeight);
          t.x = this.itemX;
          t.y = this.itemY;
          e
            ? (this.itemX += b)
            : ((this.itemY += p + d + g), (this.lastLineHeight = d));
          this.offsetWidth =
            this.widthOption ||
            Math.max(
              (e ? this.itemX - c - (a.checkbox ? 0 : n) : b) + c,
              this.offsetWidth,
            );
        }
        getAllItems() {
          let a = [];
          this.chart.series.forEach(function (b) {
            const c = b && b.options;
            b &&
              f(c.showInLegend, g(c.linkedTo) ? !1 : void 0, !0) &&
              (a = a.concat(
                (b.legendItem || {}).labels ||
                  ('point' === c.legendType ? b.data : b),
              ));
          });
          y(this, 'afterGetAllItems', { allItems: a });
          return a;
        }
        getAlignment() {
          const a = this.options;
          return this.proximate
            ? a.align.charAt(0) + 'tv'
            : a.floating
              ? ''
              : a.align.charAt(0) +
                a.verticalAlign.charAt(0) +
                a.layout.charAt(0);
        }
        adjustMargins(a, b) {
          const c = this.chart,
            e = this.options,
            d = this.getAlignment();
          d &&
            [
              /(lth|ct|rth)/,
              /(rtv|rm|rbv)/,
              /(rbh|cb|lbh)/,
              /(lbv|lm|ltv)/,
            ].forEach(function (l, p) {
              l.test(d) &&
                !g(a[p]) &&
                (c[q[p]] = Math.max(
                  c[q[p]],
                  c.legend[(p + 1) % 2 ? 'legendHeight' : 'legendWidth'] +
                    [1, -1, -1, 1][p] * e[p % 2 ? 'x' : 'y'] +
                    f(e.margin, 12) +
                    b[p] +
                    (c.titleOffset[p] || 0),
                ));
            });
        }
        proximatePositions() {
          const a = this.chart,
            b = [],
            c = 'left' === this.options.align;
          this.allItems.forEach(function (e) {
            var f;
            var d = c;
            let l;
            e.yAxis &&
              (e.xAxis.options.reversed && (d = !d),
              e.points &&
                (f = k(
                  d ? e.points : e.points.slice(0).reverse(),
                  function (b) {
                    return K(b.plotY);
                  },
                )),
              (d =
                this.itemMarginTop +
                e.legendItem.label.getBBox().height +
                this.itemMarginBottom),
              (l = e.yAxis.top - a.plotTop),
              e.visible
                ? ((f = f ? f.plotY : e.yAxis.height), (f += l - 0.3 * d))
                : (f = l + e.yAxis.height),
              b.push({ target: f, size: d, item: e }));
          }, this);
          let f;
          for (const c of r(b, a.plotHeight))
            ((f = c.item.legendItem || {}),
              K(c.pos) && (f.y = a.plotTop - a.spacing[0] + c.pos));
        }
        render() {
          const a = this.chart,
            b = a.renderer,
            c = this.options,
            f = this.padding;
          var d = this.getAllItems();
          let g,
            n = this.group,
            k = this.box;
          this.itemX = f;
          this.itemY = this.initialItemY;
          this.lastItemY = this.offsetWidth = 0;
          this.widthOption = p(c.width, a.spacingBox.width - f);
          var h = a.spacingBox.width - 2 * f - c.x;
          -1 < ['rm', 'lm'].indexOf(this.getAlignment().substring(0, 2)) &&
            (h /= 2);
          this.maxLegendWidth = this.widthOption || h;
          n ||
            ((this.group = n =
              b
                .g('legend')
                .addClass(c.className || '')
                .attr({ zIndex: 7 })
                .add()),
            (this.contentGroup = b.g().attr({ zIndex: 1 }).add(n)),
            (this.scrollGroup = b.g().add(this.contentGroup)));
          this.renderTitle();
          t(
            d,
            (b, c) =>
              ((b.options && b.options.legendIndex) || 0) -
              ((c.options && c.options.legendIndex) || 0),
          );
          c.reversed && d.reverse();
          this.allItems = d;
          this.display = h = !!d.length;
          this.itemHeight =
            this.totalItemWidth =
            this.maxItemWidth =
            this.lastLineHeight =
              0;
          d.forEach(this.renderItem, this);
          d.forEach(this.layoutItem, this);
          d = (this.widthOption || this.offsetWidth) + f;
          g = this.lastItemY + this.lastLineHeight + this.titleHeight;
          g = this.handleOverflow(g);
          g += f;
          k ||
            (this.box = k =
              b
                .rect()
                .addClass('highcharts-legend-box')
                .attr({ r: c.borderRadius })
                .add(n));
          a.styledMode ||
            k
              .attr({
                stroke: c.borderColor,
                'stroke-width': c.borderWidth || 0,
                fill: c.backgroundColor || 'none',
              })
              .shadow(c.shadow);
          if (0 < d && 0 < g)
            k[k.placed ? 'animate' : 'attr'](
              k.crisp.call(
                {},
                { x: 0, y: 0, width: d, height: g },
                k.strokeWidth(),
              ),
            );
          n[h ? 'show' : 'hide']();
          a.styledMode && 'none' === n.getStyle('display') && (d = g = 0);
          this.legendWidth = d;
          this.legendHeight = g;
          h && this.align();
          this.proximate || this.positionItems();
          y(this, 'afterRender');
        }
        align(a = this.chart.spacingBox) {
          const b = this.chart,
            c = this.options;
          let e = a.y;
          /(lth|ct|rth)/.test(this.getAlignment()) && 0 < b.titleOffset[0]
            ? (e += b.titleOffset[0])
            : /(lbh|cb|rbh)/.test(this.getAlignment()) &&
              0 < b.titleOffset[2] &&
              (e -= b.titleOffset[2]);
          e !== a.y && (a = L(a, { y: e }));
          b.hasRendered || (this.group.placed = !1);
          this.group.align(
            L(c, {
              width: this.legendWidth,
              height: this.legendHeight,
              verticalAlign: this.proximate ? 'top' : c.verticalAlign,
            }),
            !0,
            a,
          );
        }
        handleOverflow(a) {
          const b = this,
            c = this.chart,
            e = c.renderer,
            d = this.options;
          var g = d.y;
          const p = 'top' === d.verticalAlign,
            n = this.padding,
            k = d.maxHeight,
            t = d.navigation,
            h = f(t.animation, !0),
            w = t.arrowSize || 12,
            m = this.pages,
            q = this.allItems,
            v = function (c) {
              'number' === typeof c
                ? K.attr({ height: c })
                : K && ((b.clipRect = K.destroy()), b.contentGroup.clip());
              b.contentGroup.div &&
                (b.contentGroup.div.style.clip = c
                  ? 'rect(' + n + 'px,9999px,' + (n + c) + 'px,0)'
                  : 'auto');
            },
            r = function (a) {
              b[a] = e
                .circle(0, 0, 1.3 * w)
                .translate(w / 2, w / 2)
                .add(R);
              c.styledMode || b[a].attr('fill', 'rgba(0,0,0,0.0001)');
              return b[a];
            };
          let y, N, u;
          g = c.spacingBox.height + (p ? -g : g) - n;
          let R = this.nav,
            K = this.clipRect;
          'horizontal' !== d.layout ||
            'middle' === d.verticalAlign ||
            d.floating ||
            (g /= 2);
          k && (g = Math.min(g, k));
          m.length = 0;
          a && 0 < g && a > g && !1 !== t.enabled
            ? ((this.clipHeight = y =
                Math.max(g - 20 - this.titleHeight - n, 0)),
              (this.currentPage = f(this.currentPage, 1)),
              (this.fullHeight = a),
              q.forEach((b, c) => {
                u = b.legendItem || {};
                b = u.y || 0;
                const a = Math.round(u.label.getBBox().height);
                let e = m.length;
                if (!e || (b - m[e - 1] > y && (N || b) !== m[e - 1]))
                  (m.push(N || b), e++);
                u.pageIx = e - 1;
                N && ((q[c - 1].legendItem || {}).pageIx = e - 1);
                c === q.length - 1 &&
                  b + a - m[e - 1] > y &&
                  b > m[e - 1] &&
                  (m.push(b), (u.pageIx = e));
                b !== N && (N = b);
              }),
              K ||
                ((K = b.clipRect = e.clipRect(0, n - 2, 9999, 0)),
                b.contentGroup.clip(K)),
              v(y),
              R ||
                ((this.nav = R = e.g().attr({ zIndex: 1 }).add(this.group)),
                (this.up = e.symbol('triangle', 0, 0, w, w).add(R)),
                r('upTracker').on('click', function () {
                  b.scroll(-1, h);
                }),
                (this.pager = e
                  .text('', 15, 10)
                  .addClass('highcharts-legend-navigation')),
                !c.styledMode && t.style && this.pager.css(t.style),
                this.pager.add(R),
                (this.down = e.symbol('triangle-down', 0, 0, w, w).add(R)),
                r('downTracker').on('click', function () {
                  b.scroll(1, h);
                })),
              b.scroll(0),
              (a = g))
            : R &&
              (v(),
              (this.nav = R.destroy()),
              this.scrollGroup.attr({ translateY: 1 }),
              (this.clipHeight = 0));
          return a;
        }
        scroll(a, b) {
          const c = this.chart,
            e = this.pages,
            d = e.length,
            g = this.clipHeight,
            p = this.options.navigation,
            k = this.pager,
            t = this.padding;
          let h = this.currentPage + a;
          h > d && (h = d);
          0 < h &&
            ('undefined' !== typeof b && B(b, c),
            this.nav.attr({
              translateX: t,
              translateY: g + this.padding + 7 + this.titleHeight,
              visibility: 'inherit',
            }),
            [this.up, this.upTracker].forEach(function (b) {
              b.attr({
                class:
                  1 === h
                    ? 'highcharts-legend-nav-inactive'
                    : 'highcharts-legend-nav-active',
              });
            }),
            k.attr({ text: h + '/' + d }),
            [this.down, this.downTracker].forEach(function (b) {
              b.attr({
                x: 18 + this.pager.getBBox().width,
                class:
                  h === d
                    ? 'highcharts-legend-nav-inactive'
                    : 'highcharts-legend-nav-active',
              });
            }, this),
            c.styledMode ||
              (this.up.attr({
                fill: 1 === h ? p.inactiveColor : p.activeColor,
              }),
              this.upTracker.css({ cursor: 1 === h ? 'default' : 'pointer' }),
              this.down.attr({
                fill: h === d ? p.inactiveColor : p.activeColor,
              }),
              this.downTracker.css({
                cursor: h === d ? 'default' : 'pointer',
              })),
            (this.scrollOffset = -e[h - 1] + this.initialItemY),
            this.scrollGroup.animate({ translateY: this.scrollOffset }),
            (this.currentPage = h),
            this.positionCheckboxes(),
            (a = x(f(b, c.renderer.globalAnimation, !0))),
            n(() => {
              y(this, 'afterScroll', { currentPage: h });
            }, a.duration));
        }
        setItemEvents(a, b, c) {
          const e = this,
            d = a.legendItem || {},
            f = e.chart.renderer.boxWrapper,
            g = a instanceof H,
            p = 'highcharts-legend-' + (g ? 'point' : 'series') + '-active',
            n = e.chart.styledMode;
          c = c ? [b, d.symbol] : [d.group];
          const k = (b) => {
            e.allItems.forEach((c) => {
              a !== c &&
                [c].concat(c.linkedSeries || []).forEach((c) => {
                  c.setState(b, !g);
                });
            });
          };
          for (const d of c)
            if (d)
              d.on('mouseover', function () {
                a.visible && k('inactive');
                a.setState('hover');
                a.visible && f.addClass(p);
                n || b.css(e.options.itemHoverStyle);
              })
                .on('mouseout', function () {
                  e.chart.styledMode ||
                    b.css(L(a.visible ? e.itemStyle : e.itemHiddenStyle));
                  k('');
                  f.removeClass(p);
                  a.setState();
                })
                .on('click', function (b) {
                  const c = function () {
                    a.setVisible && a.setVisible();
                    k(a.visible ? 'inactive' : '');
                  };
                  f.removeClass(p);
                  b = { browserEvent: b };
                  a.firePointEvent
                    ? a.firePointEvent('legendItemClick', b, c)
                    : y(a, 'legendItemClick', b, c);
                });
        }
        createCheckboxForItem(a) {
          a.checkbox = v(
            'input',
            {
              type: 'checkbox',
              className: 'highcharts-legend-checkbox',
              checked: a.selected,
              defaultChecked: a.selected,
            },
            this.options.itemCheckboxStyle,
            this.chart.container,
          );
          m(a.checkbox, 'click', function (b) {
            y(
              a.series || a,
              'checkboxClick',
              { checked: b.target.checked, item: a },
              function () {
                a.select();
              },
            );
          });
        }
      }
      (function (a) {
        const b = [];
        a.compose = function (c) {
          z.pushUnique(b, c) &&
            m(c, 'beforeMargins', function () {
              this.legend = new a(this, this.options.legend);
            });
        };
      })(w || (w = {}));
      ('');
      return w;
    },
  );
  M(a, 'Core/Legend/LegendSymbol.js', [a['Core/Utilities.js']], function (a) {
    const { extend: x, merge: G, pick: H } = a;
    var C;
    (function (a) {
      a.lineMarker = function (a, B) {
        B = this.legendItem = this.legendItem || {};
        var u = this.options;
        const q = a.symbolWidth,
          r = a.symbolHeight,
          m = r / 2,
          v = this.chart.renderer,
          h = B.group;
        a = a.baseline - Math.round(0.3 * a.fontMetrics.b);
        let g = {},
          d = u.marker,
          k = 0;
        this.chart.styledMode ||
          ((g = { 'stroke-width': Math.min(u.lineWidth || 0, 24) }),
          u.dashStyle
            ? (g.dashstyle = u.dashStyle)
            : 'square' !== u.linecap && (g['stroke-linecap'] = 'round'));
        B.line = v.path().addClass('highcharts-graph').attr(g).add(h);
        g['stroke-linecap'] && (k = Math.min(B.line.strokeWidth(), q) / 2);
        q &&
          B.line.attr({
            d: [
              ['M', k, a],
              ['L', q - k, a],
            ],
          });
        d &&
          !1 !== d.enabled &&
          q &&
          ((u = Math.min(H(d.radius, m), m)),
          0 === this.symbol.indexOf('url') &&
            ((d = G(d, { width: r, height: r })), (u = 0)),
          (B.symbol = B =
            v
              .symbol(
                this.symbol,
                q / 2 - u,
                a - u,
                2 * u,
                2 * u,
                x({ context: 'legend' }, d),
              )
              .addClass('highcharts-point')
              .add(h)),
          (B.isMarker = !0));
      };
      a.rectangle = function (a, x) {
        x = x.legendItem || {};
        const u = a.symbolHeight,
          q = a.options.squareSymbol;
        x.symbol = this.chart.renderer
          .rect(
            q ? (a.symbolWidth - u) / 2 : 0,
            a.baseline - u + 1,
            q ? u : a.symbolWidth,
            u,
            H(a.options.symbolRadius, u / 2),
          )
          .addClass('highcharts-point')
          .attr({ zIndex: 3 })
          .add(x.group);
      };
    })(C || (C = {}));
    return C;
  });
  M(a, 'Core/Series/SeriesDefaults.js', [], function () {
    return {
      lineWidth: 1,
      allowPointSelect: !1,
      crisp: !0,
      showCheckbox: !1,
      animation: { duration: 1e3 },
      enableMouseTracking: !0,
      events: {},
      marker: {
        enabledThreshold: 2,
        lineColor: '#ffffff',
        lineWidth: 0,
        radius: 4,
        states: {
          normal: { animation: !0 },
          hover: {
            animation: { duration: 150 },
            enabled: !0,
            radiusPlus: 2,
            lineWidthPlus: 1,
          },
          select: { fillColor: '#cccccc', lineColor: '#000000', lineWidth: 2 },
        },
      },
      point: { events: {} },
      dataLabels: {
        animation: {},
        align: 'center',
        borderWidth: 0,
        defer: !0,
        formatter: function () {
          const { numberFormatter: a } = this.series.chart;
          return 'number' !== typeof this.y ? '' : a(this.y, -1);
        },
        padding: 5,
        style: {
          fontSize: '0.7em',
          fontWeight: 'bold',
          color: 'contrast',
          textOutline: '1px contrast',
        },
        verticalAlign: 'bottom',
        x: 0,
        y: 0,
      },
      cropThreshold: 300,
      opacity: 1,
      pointRange: 0,
      softThreshold: !0,
      states: {
        normal: { animation: !0 },
        hover: {
          animation: { duration: 150 },
          lineWidthPlus: 1,
          marker: {},
          halo: { size: 10, opacity: 0.25 },
        },
        select: { animation: { duration: 0 } },
        inactive: { animation: { duration: 150 }, opacity: 0.2 },
      },
      stickyTracking: !0,
      turboThreshold: 1e3,
      findNearestPointBy: 'x',
    };
  });
  M(
    a,
    'Core/Series/SeriesRegistry.js',
    [
      a['Core/Globals.js'],
      a['Core/Defaults.js'],
      a['Core/Series/Point.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H) {
      const { defaultOptions: x } = A,
        { extendClass: z, merge: D } = H;
      var B;
      (function (u) {
        function q(a, m) {
          const q = x.plotOptions || {},
            h = m.defaultOptions,
            g = m.prototype;
          g.type = a;
          g.pointClass || (g.pointClass = G);
          h && (q[a] = h);
          u.seriesTypes[a] = m;
        }
        u.seriesTypes = a.seriesTypes;
        u.registerSeriesType = q;
        u.seriesType = function (a, m, v, h, g) {
          const d = x.plotOptions || {};
          m = m || '';
          d[a] = D(d[m], v);
          q(a, z(u.seriesTypes[m] || function () {}, h));
          u.seriesTypes[a].prototype.type = a;
          g && (u.seriesTypes[a].prototype.pointClass = z(G, g));
          return u.seriesTypes[a];
        };
      })(B || (B = {}));
      return B;
    },
  );
  M(
    a,
    'Core/Series/Series.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Defaults.js'],
      a['Core/Foundation.js'],
      a['Core/Globals.js'],
      a['Core/Legend/LegendSymbol.js'],
      a['Core/Series/Point.js'],
      a['Core/Series/SeriesDefaults.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D, B, u, q) {
      const { animObject: r, setAnimation: m } = a,
        { defaultOptions: v } = A,
        { registerEventOptions: h } = G,
        { hasTouch: g, svg: d, win: k } = H,
        { seriesTypes: y } = B,
        {
          arrayMax: K,
          arrayMin: x,
          clamp: f,
          correctFloat: p,
          defined: t,
          diffObjects: n,
          erase: w,
          error: e,
          extend: b,
          find: c,
          fireEvent: l,
          getClosestDistance: I,
          getNestedProperty: F,
          insertItem: J,
          isArray: S,
          isNumber: P,
          isString: O,
          merge: Q,
          objectEach: W,
          pick: E,
          removeEvent: da,
          splat: fa,
          syncTimeout: aa,
        } = q;
      class Y {
        constructor() {
          this.zones =
            this.yAxis =
            this.xAxis =
            this.userOptions =
            this.tooltipOptions =
            this.processedYData =
            this.processedXData =
            this.points =
            this.options =
            this.linkedSeries =
            this.index =
            this.eventsToUnbind =
            this.eventOptions =
            this.data =
            this.chart =
            this._i =
              void 0;
        }
        init(c, a) {
          l(this, 'init', { options: a });
          const e = this,
            d = c.series;
          this.eventsToUnbind = [];
          e.chart = c;
          e.options = e.setOptions(a);
          a = e.options;
          e.linkedSeries = [];
          e.bindAxes();
          b(e, {
            name: a.name,
            state: '',
            visible: !1 !== a.visible,
            selected: !0 === a.selected,
          });
          h(this, a);
          const f = a.events;
          if (
            (f && f.click) ||
            (a.point && a.point.events && a.point.events.click) ||
            a.allowPointSelect
          )
            c.runTrackerClick = !0;
          e.getColor();
          e.getSymbol();
          e.parallelArrays.forEach(function (b) {
            e[b + 'Data'] || (e[b + 'Data'] = []);
          });
          e.isCartesian && (c.hasCartesianSeries = !0);
          let g;
          d.length && (g = d[d.length - 1]);
          e._i = E(g && g._i, -1) + 1;
          e.opacity = e.options.opacity;
          c.orderItems('series', J(this, d));
          a.dataSorting && a.dataSorting.enabled
            ? e.setDataSortingOptions()
            : e.points || e.data || e.setData(a.data, !1);
          l(this, 'afterInit');
        }
        is(b) {
          return y[b] && this instanceof y[b];
        }
        bindAxes() {
          const b = this,
            c = b.options,
            a = b.chart;
          let d;
          l(this, 'bindAxes', null, function () {
            (b.axisTypes || []).forEach(function (f) {
              a[f].forEach(function (a) {
                d = a.options;
                if (
                  E(c[f], 0) === a.index ||
                  ('undefined' !== typeof c[f] && c[f] === d.id)
                )
                  (J(b, a.series), (b[f] = a), (a.isDirty = !0));
              });
              b[f] || b.optionalAxis === f || e(18, !0, a);
            });
          });
          l(this, 'afterBindAxes');
        }
        updateParallelArrays(b, c, a) {
          const e = b.series,
            d = P(c)
              ? function (a) {
                  const d = 'y' === a && e.toYData ? e.toYData(b) : b[a];
                  e[a + 'Data'][c] = d;
                }
              : function (b) {
                  Array.prototype[c].apply(e[b + 'Data'], a);
                };
          e.parallelArrays.forEach(d);
        }
        hasData() {
          return (
            (this.visible &&
              'undefined' !== typeof this.dataMax &&
              'undefined' !== typeof this.dataMin) ||
            (this.visible && this.yData && 0 < this.yData.length)
          );
        }
        autoIncrement(b) {
          var c = this.options;
          const a = c.pointIntervalUnit,
            e = c.relativeXValue,
            d = this.chart.time;
          let f = this.xIncrement,
            l;
          f = E(f, c.pointStart, 0);
          this.pointInterval = l = E(this.pointInterval, c.pointInterval, 1);
          e && P(b) && (l *= b);
          a &&
            ((c = new d.Date(f)),
            'day' === a
              ? d.set('Date', c, d.get('Date', c) + l)
              : 'month' === a
                ? d.set('Month', c, d.get('Month', c) + l)
                : 'year' === a &&
                  d.set('FullYear', c, d.get('FullYear', c) + l),
            (l = c.getTime() - f));
          if (e && P(b)) return f + l;
          this.xIncrement = f + l;
          return f;
        }
        setDataSortingOptions() {
          const c = this.options;
          b(this, {
            requireSorting: !1,
            sorted: !1,
            enabledDataSorting: !0,
            allowDG: !1,
          });
          t(c.pointRange) || (c.pointRange = 1);
        }
        setOptions(b) {
          var c, a;
          const e = this.chart;
          var d = e.options.plotOptions,
            f = e.userOptions || {};
          const g = Q(b);
          b = e.styledMode;
          const p = { plotOptions: d, userOptions: g };
          l(this, 'setOptions', p);
          const n = p.plotOptions[this.type];
          f = f.plotOptions || {};
          const k = f.series || {},
            h = v.plotOptions[this.type] || {},
            w = f[this.type] || {};
          this.userOptions = p.userOptions;
          d = Q(n, d.series, w, g);
          this.tooltipOptions = Q(
            v.tooltip,
            null === (c = v.plotOptions.series) || void 0 === c
              ? void 0
              : c.tooltip,
            null === h || void 0 === h ? void 0 : h.tooltip,
            e.userOptions.tooltip,
            null === (a = f.series) || void 0 === a ? void 0 : a.tooltip,
            w.tooltip,
            g.tooltip,
          );
          this.stickyTracking = E(
            g.stickyTracking,
            w.stickyTracking,
            k.stickyTracking,
            this.tooltipOptions.shared && !this.noSharedTooltip
              ? !0
              : d.stickyTracking,
          );
          null === n.marker && delete d.marker;
          this.zoneAxis = d.zoneAxis;
          a = this.zones = (d.zones || []).slice();
          (!d.negativeColor && !d.negativeFillColor) ||
            d.zones ||
            ((c = {
              value: d[this.zoneAxis + 'Threshold'] || d.threshold || 0,
              className: 'highcharts-negative',
            }),
            b ||
              ((c.color = d.negativeColor),
              (c.fillColor = d.negativeFillColor)),
            a.push(c));
          a.length &&
            t(a[a.length - 1].value) &&
            a.push(b ? {} : { color: this.color, fillColor: this.fillColor });
          l(this, 'afterSetOptions', { options: d });
          return d;
        }
        getName() {
          return E(this.options.name, 'Series ' + (this.index + 1));
        }
        getCyclic(b, c, a) {
          const e = this.chart,
            d = `${b}Index`,
            f = `${b}Counter`,
            l =
              (null === a || void 0 === a ? void 0 : a.length) ||
              e.options.chart.colorCount;
          if (!c) {
            var g = E(
              'color' === b ? this.options.colorIndex : void 0,
              this[d],
            );
            t(g) ||
              (e.series.length || (e[f] = 0), (g = e[f] % l), (e[f] += 1));
            a && (c = a[g]);
          }
          'undefined' !== typeof g && (this[d] = g);
          this[b] = c;
        }
        getColor() {
          this.chart.styledMode
            ? this.getCyclic('color')
            : this.options.colorByPoint
              ? (this.color = '#cccccc')
              : this.getCyclic(
                  'color',
                  this.options.color || v.plotOptions[this.type].color,
                  this.chart.options.colors,
                );
        }
        getPointsCollection() {
          return (this.hasGroupedData ? this.points : this.data) || [];
        }
        getSymbol() {
          this.getCyclic(
            'symbol',
            this.options.marker.symbol,
            this.chart.options.symbols,
          );
        }
        findPointIndex(b, a) {
          const e = b.id,
            d = b.x,
            f = this.points;
          var l = this.options.dataSorting,
            g;
          let p, n;
          if (e) ((l = this.chart.get(e)), l instanceof z && (g = l));
          else if (
            this.linkedParent ||
            this.enabledDataSorting ||
            this.options.relativeXValue
          )
            if (
              ((g = (c) => !c.touched && c.index === b.index),
              l && l.matchByName
                ? (g = (c) => !c.touched && c.name === b.name)
                : this.options.relativeXValue &&
                  (g = (c) => !c.touched && c.options.x === b.x),
              (g = c(f, g)),
              !g)
            )
              return;
          g && ((n = g && g.index), 'undefined' !== typeof n && (p = !0));
          'undefined' === typeof n && P(d) && (n = this.xData.indexOf(d, a));
          -1 !== n &&
            'undefined' !== typeof n &&
            this.cropped &&
            (n = n >= this.cropStart ? n - this.cropStart : n);
          !p && P(n) && f[n] && f[n].touched && (n = void 0);
          return n;
        }
        updateData(b, c) {
          const a = this.options,
            e = a.dataSorting,
            d = this.points,
            f = [],
            l = this.requireSorting,
            g = b.length === d.length;
          let p,
            n,
            k,
            h = !0;
          this.xIncrement = null;
          b.forEach(function (b, c) {
            var n =
              (t(b) &&
                this.pointClass.prototype.optionsToObject.call(
                  { series: this },
                  b,
                )) ||
              {};
            const h = n.x;
            if (n.id || P(h)) {
              if (
                ((n = this.findPointIndex(n, k)),
                -1 === n || 'undefined' === typeof n
                  ? f.push(b)
                  : d[n] && b !== a.data[n]
                    ? (d[n].update(b, !1, null, !1),
                      (d[n].touched = !0),
                      l && (k = n + 1))
                    : d[n] && (d[n].touched = !0),
                !g || c !== n || (e && e.enabled) || this.hasDerivedData)
              )
                p = !0;
            } else f.push(b);
          }, this);
          if (p)
            for (b = d.length; b--; )
              (n = d[b]) && !n.touched && n.remove && n.remove(!1, c);
          else
            !g || (e && e.enabled)
              ? (h = !1)
              : (b.forEach(function (b, c) {
                  b === d[c].y ||
                    d[c].destroyed ||
                    d[c].update(b, !1, null, !1);
                }),
                (f.length = 0));
          d.forEach(function (b) {
            b && (b.touched = !1);
          });
          if (!h) return !1;
          f.forEach(function (b) {
            this.addPoint(b, !1, null, null, !1);
          }, this);
          null === this.xIncrement &&
            this.xData &&
            this.xData.length &&
            ((this.xIncrement = K(this.xData)), this.autoIncrement());
          return !0;
        }
        setData(b, c = !0, a, d) {
          var f;
          const l = this,
            g = l.points,
            n = (g && g.length) || 0,
            p = l.options,
            k = l.chart,
            h = p.dataSorting,
            t = l.xAxis,
            w = p.turboThreshold,
            m = this.xData,
            q = this.yData;
          var v = l.pointArrayMap;
          v = v && v.length;
          const r = p.keys;
          let y,
            I = 0,
            F = 1,
            J = null;
          if (!k.options.chart.allowMutatingData) {
            p.data && delete l.options.data;
            l.userOptions.data && delete l.userOptions.data;
            var N = Q(!0, b);
          }
          b = N || b || [];
          N = b.length;
          h && h.enabled && (b = this.sortData(b));
          k.options.chart.allowMutatingData &&
            !1 !== d &&
            N &&
            n &&
            !l.cropped &&
            !l.hasGroupedData &&
            l.visible &&
            !l.boosted &&
            (y = this.updateData(b, a));
          if (!y) {
            l.xIncrement = null;
            l.colorCounter = 0;
            this.parallelArrays.forEach(function (b) {
              l[b + 'Data'].length = 0;
            });
            if (w && N > w)
              if (((J = l.getFirstValidPoint(b)), P(J)))
                for (a = 0; a < N; a++)
                  ((m[a] = this.autoIncrement()), (q[a] = b[a]));
              else if (S(J))
                if (v)
                  if (J.length === v)
                    for (a = 0; a < N; a++)
                      ((m[a] = this.autoIncrement()), (q[a] = b[a]));
                  else
                    for (a = 0; a < N; a++)
                      ((d = b[a]), (m[a] = d[0]), (q[a] = d.slice(1, v + 1)));
                else if (
                  (r &&
                    ((I = r.indexOf('x')),
                    (F = r.indexOf('y')),
                    (I = 0 <= I ? I : 0),
                    (F = 0 <= F ? F : 1)),
                  1 === J.length && (F = 0),
                  I === F)
                )
                  for (a = 0; a < N; a++)
                    ((m[a] = this.autoIncrement()), (q[a] = b[a][F]));
                else
                  for (a = 0; a < N; a++)
                    ((d = b[a]), (m[a] = d[I]), (q[a] = d[F]));
              else e(12, !1, k);
            else
              for (a = 0; a < N; a++)
                ((d = { series: l }),
                  l.pointClass.prototype.applyOptions.apply(d, [b[a]]),
                  l.updateParallelArrays(d, a));
            q && O(q[0]) && e(14, !0, k);
            l.data = [];
            l.options.data = l.userOptions.data = b;
            for (a = n; a--; )
              null === (f = g[a]) || void 0 === f ? void 0 : f.destroy();
            t && (t.minRange = t.userMinRange);
            l.isDirty = k.isDirtyBox = !0;
            l.isDirtyData = !!g;
            a = !1;
          }
          'point' === p.legendType &&
            (this.processData(), this.generatePoints());
          c && k.redraw(a);
        }
        sortData(b) {
          const c = this,
            a = c.options.dataSorting.sortKey || 'y',
            e = function (b, c) {
              return (
                (t(c) &&
                  b.pointClass.prototype.optionsToObject.call(
                    { series: b },
                    c,
                  )) ||
                {}
              );
            };
          b.forEach(function (a, d) {
            b[d] = e(c, a);
            b[d].index = d;
          }, this);
          b.concat()
            .sort((b, c) => {
              b = F(a, b);
              c = F(a, c);
              return c < b ? -1 : c > b ? 1 : 0;
            })
            .forEach(function (b, c) {
              b.x = c;
            }, this);
          c.linkedSeries &&
            c.linkedSeries.forEach(function (c) {
              const a = c.options,
                d = a.data;
              (a.dataSorting && a.dataSorting.enabled) ||
                !d ||
                (d.forEach(function (a, f) {
                  d[f] = e(c, a);
                  b[f] && ((d[f].x = b[f].x), (d[f].index = f));
                }),
                c.setData(d, !1));
            });
          return b;
        }
        getProcessedData(b) {
          const c = this;
          var a = c.xAxis,
            d = c.options;
          const f = d.cropThreshold,
            l = b || c.getExtremesFromAll || d.getExtremesFromAll,
            g = null === a || void 0 === a ? void 0 : a.logarithmic,
            p = c.isCartesian;
          let n = 0;
          let k;
          b = c.xData;
          d = c.yData;
          let h = !1;
          const t = b.length;
          if (a) {
            var w = a.getExtremes();
            k = w.min;
            w = w.max;
            h = !(!a.categories || a.names.length);
          }
          if (p && c.sorted && !l && (!f || t > f || c.forceCrop))
            if (b[t - 1] < k || b[0] > w) ((b = []), (d = []));
            else if (c.yData && (b[0] < k || b[t - 1] > w)) {
              var m = this.cropData(c.xData, c.yData, k, w);
              b = m.xData;
              d = m.yData;
              n = m.start;
              m = !0;
            }
          a = I(
            [g ? b.map(g.log2lin) : b],
            () => c.requireSorting && !h && e(15, !1, c.chart),
          );
          return {
            xData: b,
            yData: d,
            cropped: m,
            cropStart: n,
            closestPointRange: a,
          };
        }
        processData(b) {
          const c = this.xAxis;
          if (
            this.isCartesian &&
            !this.isDirty &&
            !c.isDirty &&
            !this.yAxis.isDirty &&
            !b
          )
            return !1;
          b = this.getProcessedData();
          this.cropped = b.cropped;
          this.cropStart = b.cropStart;
          this.processedXData = b.xData;
          this.processedYData = b.yData;
          this.closestPointRange = this.basePointRange = b.closestPointRange;
          l(this, 'afterProcessData');
        }
        cropData(b, c, a, e, d) {
          const f = b.length;
          let l,
            g = 0,
            n = f;
          d = E(d, this.cropShoulder);
          for (l = 0; l < f; l++)
            if (b[l] >= a) {
              g = Math.max(0, l - d);
              break;
            }
          for (a = l; a < f; a++)
            if (b[a] > e) {
              n = a + d;
              break;
            }
          return {
            xData: b.slice(g, n),
            yData: c.slice(g, n),
            start: g,
            end: n,
          };
        }
        generatePoints() {
          var c = this.options;
          const a = this.processedData || c.data,
            e = this.processedXData,
            d = this.processedYData,
            f = this.pointClass,
            g = e.length,
            n = this.cropStart || 0,
            p = this.hasGroupedData,
            k = c.keys,
            h = [];
          c = c.dataGrouping && c.dataGrouping.groupAll ? n : 0;
          let t;
          let w,
            m,
            q = this.data;
          if (!q && !p) {
            var v = [];
            v.length = a.length;
            q = this.data = v;
          }
          k && p && (this.options.keys = !1);
          for (m = 0; m < g; m++)
            ((v = n + m),
              p
                ? ((w = new f().init(this, [e[m]].concat(fa(d[m])))),
                  (w.dataGroup = this.groupMap[c + m]),
                  w.dataGroup.options &&
                    ((w.options = w.dataGroup.options),
                    b(w, w.dataGroup.options),
                    delete w.dataLabels))
                : (w = q[v]) ||
                  'undefined' === typeof a[v] ||
                  (q[v] = w = new f().init(this, a[v], e[m])),
              w && ((w.index = p ? c + m : v), (h[m] = w)));
          this.options.keys = k;
          if (q && (g !== (t = q.length) || p))
            for (m = 0; m < t; m++)
              (m !== n || p || (m += g),
                q[m] && (q[m].destroyElements(), (q[m].plotX = void 0)));
          this.data = q;
          this.points = h;
          l(this, 'afterGeneratePoints');
        }
        getXExtremes(b) {
          return { min: x(b), max: K(b) };
        }
        getExtremes(b, c) {
          const a = this.xAxis;
          var e = this.yAxis;
          const d = this.processedXData || this.xData,
            f = [],
            g = this.requireSorting ? this.cropShoulder : 0;
          e = e ? e.positiveValuesOnly : !1;
          let n,
            p = 0,
            k = 0,
            h = 0;
          b = b || this.stackedYData || this.processedYData || [];
          const t = b.length;
          if (a) {
            var m = a.getExtremes();
            p = m.min;
            k = m.max;
          }
          for (n = 0; n < t; n++) {
            var w = d[n];
            m = b[n];
            var q = (P(m) || S(m)) && (m.length || 0 < m || !e);
            w =
              c ||
              this.getExtremesFromAll ||
              this.options.getExtremesFromAll ||
              this.cropped ||
              !a ||
              ((d[n + g] || w) >= p && (d[n - g] || w) <= k);
            if (q && w)
              if ((q = m.length)) for (; q--; ) P(m[q]) && (f[h++] = m[q]);
              else f[h++] = m;
          }
          b = { activeYData: f, dataMin: x(f), dataMax: K(f) };
          l(this, 'afterGetExtremes', { dataExtremes: b });
          return b;
        }
        applyExtremes() {
          const b = this.getExtremes();
          this.dataMin = b.dataMin;
          this.dataMax = b.dataMax;
          return b;
        }
        getFirstValidPoint(b) {
          const c = b.length;
          let a = 0,
            e = null;
          for (; null === e && a < c; ) ((e = b[a]), a++);
          return e;
        }
        translate() {
          var b;
          this.processedXData || this.processData();
          this.generatePoints();
          var c = this.options;
          const a = c.stacking,
            e = this.xAxis,
            d = e.categories,
            g = this.enabledDataSorting,
            n = this.yAxis,
            k = this.points,
            h = k.length,
            m = this.pointPlacementToXValue(),
            w = !!m,
            q = c.threshold;
          c = c.startFromThreshold ? q : 0;
          let v,
            r,
            y,
            I,
            F = Number.MAX_VALUE;
          for (v = 0; v < h; v++) {
            const l = k[v],
              h = l.x;
            let J,
              O,
              u = l.y,
              N = l.low;
            const K =
              a &&
              (null === (b = n.stacking) || void 0 === b
                ? void 0
                : b.stacks[
                    (this.negStacks && u < (c ? 0 : q) ? '-' : '') +
                      this.stackKey
                  ]);
            r = e.translate(h, !1, !1, !1, !0, m);
            l.plotX = P(r) ? p(f(r, -1e5, 1e5)) : void 0;
            a &&
              this.visible &&
              K &&
              K[h] &&
              ((I = this.getStackIndicator(I, h, this.index)),
              !l.isNull && I.key && ((J = K[h]), (O = J.points[I.key])),
              J &&
                S(O) &&
                ((N = O[0]),
                (u = O[1]),
                N === c && I.key === K[h].base && (N = E(P(q) ? q : n.min)),
                n.positiveValuesOnly && t(N) && 0 >= N && (N = void 0),
                (l.total = l.stackTotal = E(J.total)),
                (l.percentage =
                  t(l.y) && J.total ? (l.y / J.total) * 100 : void 0),
                (l.stackY = u),
                this.irregularWidths ||
                  J.setOffset(
                    this.pointXOffset || 0,
                    this.barW || 0,
                    void 0,
                    void 0,
                    void 0,
                    this.xAxis,
                  )));
            l.yBottom = t(N)
              ? f(n.translate(N, !1, !0, !1, !0), -1e5, 1e5)
              : void 0;
            this.dataModify && (u = this.dataModify.modifyValue(u, v));
            let x;
            P(u) &&
              void 0 !== l.plotX &&
              ((x = n.translate(u, !1, !0, !1, !0)),
              (x = P(x) ? f(x, -1e5, 1e5) : void 0));
            l.plotY = x;
            l.isInside = this.isPointInside(l);
            l.clientX = w ? p(e.translate(h, !1, !1, !1, !0, m)) : r;
            l.negative = (l.y || 0) < (q || 0);
            l.category = E(d && d[l.x], l.x);
            l.isNull ||
              !1 === l.visible ||
              ('undefined' !== typeof y && (F = Math.min(F, Math.abs(r - y))),
              (y = r));
            l.zone = this.zones.length ? l.getZone() : void 0;
            !l.graphic && this.group && g && (l.isNew = !0);
          }
          this.closestPointRangePx = F;
          l(this, 'afterTranslate');
        }
        getValidPoints(b, c, a) {
          const e = this.chart;
          return (b || this.points || []).filter(function (b) {
            const { plotX: d, plotY: f } = b;
            return (!a && (b.isNull || !P(f))) ||
              (c && !e.isInsidePlot(d, f, { inverted: e.inverted }))
              ? !1
              : !1 !== b.visible;
          });
        }
        getClipBox() {
          const { chart: b, xAxis: c, yAxis: a } = this,
            e = Q(b.clipBox);
          c && c.len !== b.plotSizeX && (e.width = c.len);
          a && a.len !== b.plotSizeY && (e.height = a.len);
          return e;
        }
        getSharedClipKey() {
          return (this.sharedClipKey =
            (this.options.xAxis || 0) + ',' + (this.options.yAxis || 0));
        }
        setClip() {
          const { chart: b, group: c, markerGroup: a } = this,
            e = b.sharedClips,
            d = b.renderer,
            f = this.getClipBox(),
            l = this.getSharedClipKey();
          let g = e[l];
          g ? g.animate(f) : (e[l] = g = d.clipRect(f));
          c && c.clip(!1 === this.options.clip ? void 0 : g);
          a && a.clip();
        }
        animate(b) {
          const { chart: c, group: a, markerGroup: e } = this,
            d = c.inverted;
          var f = r(this.options.animation),
            l = [this.getSharedClipKey(), f.duration, f.easing, f.defer].join();
          let g = c.sharedClips[l],
            n = c.sharedClips[l + 'm'];
          if (b && a)
            ((f = this.getClipBox()),
              g
                ? g.attr('height', f.height)
                : ((f.width = 0),
                  d && (f.x = c.plotHeight),
                  (g = c.renderer.clipRect(f)),
                  (c.sharedClips[l] = g),
                  (n = c.renderer.clipRect({
                    x: -99,
                    y: -99,
                    width: d ? c.plotWidth + 199 : 99,
                    height: d ? 99 : c.plotHeight + 199,
                  })),
                  (c.sharedClips[l + 'm'] = n)),
              a.clip(g),
              e && e.clip(n));
          else if (g && !g.hasClass('highcharts-animating')) {
            l = this.getClipBox();
            const b = f.step;
            e &&
              e.element.childNodes.length &&
              (f.step = function (c, a) {
                b && b.apply(a, arguments);
                'width' === a.prop &&
                  n &&
                  n.element &&
                  n.attr(d ? 'height' : 'width', c + 99);
              });
            g.addClass('highcharts-animating').animate(l, f);
          }
        }
        afterAnimate() {
          this.setClip();
          W(this.chart.sharedClips, (b, c, a) => {
            b &&
              !this.chart.container.querySelector(
                `[clip-path="url(#${b.id})"]`,
              ) &&
              (b.destroy(), delete a[c]);
          });
          this.finishedAnimating = !0;
          l(this, 'afterAnimate');
        }
        drawPoints(b = this.points) {
          const c = this.chart,
            a = c.styledMode,
            { colorAxis: e, options: d } = this,
            f = d.marker,
            l = this[this.specialGroup || 'markerGroup'],
            g = this.xAxis,
            n = E(
              f.enabled,
              !g || g.isRadial ? !0 : null,
              this.closestPointRangePx >= f.enabledThreshold * f.radius,
            );
          let p, k, h, t;
          let m, w;
          if (!1 !== f.enabled || this._hasPointMarkers)
            for (p = 0; p < b.length; p++) {
              k = b[p];
              t = (h = k.graphic) ? 'animate' : 'attr';
              var q = k.marker || {};
              m = !!k.marker;
              if (
                ((n && 'undefined' === typeof q.enabled) || q.enabled) &&
                !k.isNull &&
                !1 !== k.visible
              ) {
                const b = E(q.symbol, this.symbol, 'rect');
                w = this.markerAttribs(k, k.selected && 'select');
                this.enabledDataSorting &&
                  (k.startXPos = g.reversed ? -(w.width || 0) : g.width);
                const d = !1 !== k.isInside;
                !h &&
                  d &&
                  (0 < (w.width || 0) || k.hasImage) &&
                  ((k.graphic = h =
                    c.renderer
                      .symbol(b, w.x, w.y, w.width, w.height, m ? q : f)
                      .add(l)),
                  this.enabledDataSorting &&
                    c.hasRendered &&
                    (h.attr({ x: k.startXPos }), (t = 'animate')));
                h && 'animate' === t && h[d ? 'show' : 'hide'](d).animate(w);
                if (h)
                  if (
                    ((q = this.pointAttribs(
                      k,
                      a || !k.selected ? void 0 : 'select',
                    )),
                    a)
                  )
                    e && h.css({ fill: q.fill });
                  else h[t](q);
                h && h.addClass(k.getClassName(), !0);
              } else h && (k.graphic = h.destroy());
            }
        }
        markerAttribs(b, c) {
          const a = this.options;
          var e = a.marker;
          const d = b.marker || {},
            f = d.symbol || e.symbol,
            l = {};
          let g = E(d.radius, e && e.radius);
          c &&
            ((e = e.states[c]),
            (c = d.states && d.states[c]),
            (g = E(
              c && c.radius,
              e && e.radius,
              g && g + ((e && e.radiusPlus) || 0),
            )));
          b.hasImage = f && 0 === f.indexOf('url');
          b.hasImage && (g = 0);
          b = b.pos();
          P(g) &&
            b &&
            ((l.x = b[0] - g),
            (l.y = b[1] - g),
            a.crisp && (l.x = Math.floor(l.x)));
          g && (l.width = l.height = 2 * g);
          return l;
        }
        pointAttribs(b, c) {
          var a = this.options.marker,
            e = b && b.options;
          const d = (e && e.marker) || {};
          var f = e && e.color,
            l = b && b.color;
          const g = b && b.zone && b.zone.color;
          let n = this.color;
          b = E(d.lineWidth, a.lineWidth);
          e = 1;
          n = f || g || l || n;
          f = d.fillColor || a.fillColor || n;
          l = d.lineColor || a.lineColor || n;
          c = c || 'normal';
          a = a.states[c] || {};
          c = (d.states && d.states[c]) || {};
          b = E(
            c.lineWidth,
            a.lineWidth,
            b + E(c.lineWidthPlus, a.lineWidthPlus, 0),
          );
          f = c.fillColor || a.fillColor || f;
          l = c.lineColor || a.lineColor || l;
          e = E(c.opacity, a.opacity, e);
          return { stroke: l, 'stroke-width': b, fill: f, opacity: e };
        }
        destroy(b) {
          const c = this,
            a = c.chart,
            e = /AppleWebKit\/533/.test(k.navigator.userAgent),
            d = c.data || [];
          let f, g, n, p;
          l(c, 'destroy', { keepEventsForUpdate: b });
          this.removeEvents(b);
          (c.axisTypes || []).forEach(function (b) {
            (p = c[b]) &&
              p.series &&
              (w(p.series, c), (p.isDirty = p.forceRedraw = !0));
          });
          c.legendItem && c.chart.legend.destroyItem(c);
          for (g = d.length; g--; ) (n = d[g]) && n.destroy && n.destroy();
          c.clips && c.clips.forEach((b) => b.destroy());
          q.clearTimeout(c.animationTimeout);
          W(c, function (b, c) {
            b instanceof u &&
              !b.survive &&
              ((f = e && 'group' === c ? 'hide' : 'destroy'), b[f]());
          });
          a.hoverSeries === c && (a.hoverSeries = void 0);
          w(a.series, c);
          a.orderItems('series');
          W(c, function (a, e) {
            (b && 'hcEvents' === e) || delete c[e];
          });
        }
        applyZones() {
          const b = this,
            c = this.chart,
            a = c.renderer,
            e = this.zones,
            d = this.clips || [],
            l = this.graph,
            g = this.area,
            n = Math.max(c.plotWidth, c.plotHeight),
            p = this[(this.zoneAxis || 'y') + 'Axis'],
            k = c.inverted;
          let h,
            t,
            m,
            w,
            q,
            v,
            r,
            y,
            I,
            F,
            J,
            u = !1;
          e.length && (l || g) && p && 'undefined' !== typeof p.min
            ? ((q = p.reversed),
              (v = p.horiz),
              l && !this.showLine && l.hide(),
              g && g.hide(),
              (w = p.getExtremes()),
              e.forEach(function (e, O) {
                h = q ? (v ? c.plotWidth : 0) : v ? 0 : p.toPixels(w.min) || 0;
                h = f(E(t, h), 0, n);
                t = f(Math.round(p.toPixels(E(e.value, w.max), !0) || 0), 0, n);
                u && (h = t = p.toPixels(w.max));
                r = Math.abs(h - t);
                y = Math.min(h, t);
                I = Math.max(h, t);
                p.isXAxis
                  ? ((m = { x: k ? I : y, y: 0, width: r, height: n }),
                    v || (m.x = c.plotHeight - m.x))
                  : ((m = { x: 0, y: k ? I : y, width: n, height: r }),
                    v && (m.y = c.plotWidth - m.y));
                d[O] ? d[O].animate(m) : (d[O] = a.clipRect(m));
                F = b['zone-area-' + O];
                J = b['zone-graph-' + O];
                l && J && J.clip(d[O]);
                g && F && F.clip(d[O]);
                u = e.value > w.max;
                b.resetZones && 0 === t && (t = void 0);
              }),
              (this.clips = d))
            : b.visible && (l && l.show(), g && g.show());
        }
        plotGroup(b, c, a, e, d) {
          let f = this[b];
          const l = !f;
          a = { visibility: a, zIndex: e || 0.1 };
          'undefined' === typeof this.opacity ||
            this.chart.styledMode ||
            'inactive' === this.state ||
            (a.opacity = this.opacity);
          l && (this[b] = f = this.chart.renderer.g().add(d));
          f.addClass(
            'highcharts-' +
              c +
              ' highcharts-series-' +
              this.index +
              ' highcharts-' +
              this.type +
              '-series ' +
              (t(this.colorIndex)
                ? 'highcharts-color-' + this.colorIndex + ' '
                : '') +
              (this.options.className || '') +
              (f.hasClass('highcharts-tracker') ? ' highcharts-tracker' : ''),
            !0,
          );
          f.attr(a)[l ? 'attr' : 'animate'](this.getPlotBox(c));
          return f;
        }
        getPlotBox(b) {
          let c = this.xAxis,
            a = this.yAxis;
          const e = this.chart;
          b =
            e.inverted &&
            !e.polar &&
            c &&
            !1 !== this.invertible &&
            'series' === b;
          e.inverted && ((c = a), (a = this.xAxis));
          return {
            translateX: c ? c.left : e.plotLeft,
            translateY: a ? a.top : e.plotTop,
            rotation: b ? 90 : 0,
            rotationOriginX: b ? (c.len - a.len) / 2 : 0,
            rotationOriginY: b ? (c.len + a.len) / 2 : 0,
            scaleX: b ? -1 : 1,
            scaleY: 1,
          };
        }
        removeEvents(b) {
          b || da(this);
          this.eventsToUnbind.length &&
            (this.eventsToUnbind.forEach(function (b) {
              b();
            }),
            (this.eventsToUnbind.length = 0));
        }
        render() {
          const b = this;
          var c = b.chart;
          const a = b.options,
            e = r(a.animation),
            d = b.visible ? 'inherit' : 'hidden',
            f = a.zIndex,
            g = b.hasRendered;
          c = c.seriesGroup;
          let n = b.finishedAnimating ? 0 : e.duration;
          l(this, 'render');
          b.plotGroup('group', 'series', d, f, c);
          b.markerGroup = b.plotGroup('markerGroup', 'markers', d, f, c);
          !1 !== a.clip && b.setClip();
          b.animate && n && b.animate(!0);
          b.drawGraph && (b.drawGraph(), b.applyZones());
          b.visible && b.drawPoints();
          b.drawDataLabels && b.drawDataLabels();
          b.redrawPoints && b.redrawPoints();
          b.drawTracker && a.enableMouseTracking && b.drawTracker();
          b.animate && n && b.animate();
          g ||
            (n && e.defer && (n += e.defer),
            (b.animationTimeout = aa(function () {
              b.afterAnimate();
            }, n || 0)));
          b.isDirty = !1;
          b.hasRendered = !0;
          l(b, 'afterRender');
        }
        redraw() {
          const b = this.isDirty || this.isDirtyData;
          this.translate();
          this.render();
          b && delete this.kdTree;
        }
        searchPoint(b, c) {
          const a = this.xAxis,
            e = this.yAxis,
            d = this.chart.inverted;
          return this.searchKDTree(
            {
              clientX: d ? a.len - b.chartY + a.pos : b.chartX - a.pos,
              plotY: d ? e.len - b.chartX + e.pos : b.chartY - e.pos,
            },
            c,
            b,
          );
        }
        buildKDTree(b) {
          function c(b, e, d) {
            var f = b && b.length;
            let l;
            if (f)
              return (
                (l = a.kdAxisArray[e % d]),
                b.sort(function (b, c) {
                  return b[l] - c[l];
                }),
                (f = Math.floor(f / 2)),
                {
                  point: b[f],
                  left: c(b.slice(0, f), e + 1, d),
                  right: c(b.slice(f + 1), e + 1, d),
                }
              );
          }
          this.buildingKdTree = !0;
          const a = this,
            e = -1 < a.options.findNearestPointBy.indexOf('y') ? 2 : 1;
          delete a.kdTree;
          aa(
            function () {
              a.kdTree = c(a.getValidPoints(null, !a.directTouch), e, e);
              a.buildingKdTree = !1;
            },
            a.options.kdNow || (b && 'touchstart' === b.type) ? 0 : 1,
          );
        }
        searchKDTree(b, c, a) {
          function e(b, c, a, n) {
            const p = c.point;
            var k = d.kdAxisArray[a % n];
            let h = p;
            var m = t(b[f]) && t(p[f]) ? Math.pow(b[f] - p[f], 2) : null;
            var w = t(b[l]) && t(p[l]) ? Math.pow(b[l] - p[l], 2) : null;
            w = (m || 0) + (w || 0);
            p.dist = t(w) ? Math.sqrt(w) : Number.MAX_VALUE;
            p.distX = t(m) ? Math.sqrt(m) : Number.MAX_VALUE;
            k = b[k] - p[k];
            w = 0 > k ? 'left' : 'right';
            m = 0 > k ? 'right' : 'left';
            c[w] && ((w = e(b, c[w], a + 1, n)), (h = w[g] < h[g] ? w : p));
            c[m] &&
              Math.sqrt(k * k) < h[g] &&
              ((b = e(b, c[m], a + 1, n)), (h = b[g] < h[g] ? b : h));
            return h;
          }
          const d = this,
            f = this.kdAxisArray[0],
            l = this.kdAxisArray[1],
            g = c ? 'distX' : 'dist';
          c = -1 < d.options.findNearestPointBy.indexOf('y') ? 2 : 1;
          this.kdTree || this.buildingKdTree || this.buildKDTree(a);
          if (this.kdTree) return e(b, this.kdTree, c, c);
        }
        pointPlacementToXValue() {
          const {
            options: { pointPlacement: b, pointRange: c },
            xAxis: a,
          } = this;
          let e = b;
          'between' === e && (e = a.reversed ? -0.5 : 0.5);
          return P(e) ? e * (c || a.pointRange) : 0;
        }
        isPointInside(b) {
          const { chart: c, xAxis: a, yAxis: e } = this;
          return (
            'undefined' !== typeof b.plotY &&
            'undefined' !== typeof b.plotX &&
            0 <= b.plotY &&
            b.plotY <= (e ? e.len : c.plotHeight) &&
            0 <= b.plotX &&
            b.plotX <= (a ? a.len : c.plotWidth)
          );
        }
        drawTracker() {
          const b = this,
            c = b.options,
            a = c.trackByArea,
            e = [].concat(a ? b.areaPath : b.graphPath),
            f = b.chart,
            n = f.pointer,
            p = f.renderer,
            k = f.options.tooltip.snap,
            h = b.tracker,
            t = function (a) {
              if (c.enableMouseTracking && f.hoverSeries !== b) b.onMouseOver();
            },
            m = 'rgba(192,192,192,' + (d ? 0.0001 : 0.002) + ')';
          h
            ? h.attr({ d: e })
            : b.graph &&
              ((b.tracker = p
                .path(e)
                .attr({
                  visibility: b.visible ? 'inherit' : 'hidden',
                  zIndex: 2,
                })
                .addClass(
                  a ? 'highcharts-tracker-area' : 'highcharts-tracker-line',
                )
                .add(b.group)),
              f.styledMode ||
                b.tracker.attr({
                  'stroke-linecap': 'round',
                  'stroke-linejoin': 'round',
                  stroke: m,
                  fill: a ? m : 'none',
                  'stroke-width': b.graph.strokeWidth() + (a ? 0 : 2 * k),
                }),
              [b.tracker, b.markerGroup, b.dataLabelsGroup].forEach(
                function (b) {
                  if (
                    b &&
                    (b
                      .addClass('highcharts-tracker')
                      .on('mouseover', t)
                      .on('mouseout', function (b) {
                        n.onTrackerMouseOut(b);
                      }),
                    c.cursor && !f.styledMode && b.css({ cursor: c.cursor }),
                    g)
                  )
                    b.on('touchstart', t);
                },
              ));
          l(this, 'afterDrawTracker');
        }
        addPoint(b, c, a, e, d) {
          const f = this.options,
            g = this.data,
            n = this.chart;
          var p = this.xAxis;
          p = p && p.hasNames && p.names;
          const k = f.data,
            h = this.xData;
          let t, m;
          c = E(c, !0);
          const w = { series: this };
          this.pointClass.prototype.applyOptions.apply(w, [b]);
          const q = w.x;
          m = h.length;
          if (this.requireSorting && q < h[m - 1])
            for (t = !0; m && h[m - 1] > q; ) m--;
          this.updateParallelArrays(w, 'splice', [m, 0, 0]);
          this.updateParallelArrays(w, m);
          p && w.name && (p[q] = w.name);
          k.splice(m, 0, b);
          if (t || this.processedData)
            (this.data.splice(m, 0, null), this.processData());
          'point' === f.legendType && this.generatePoints();
          a &&
            (g[0] && g[0].remove
              ? g[0].remove(!1)
              : (g.shift(), this.updateParallelArrays(w, 'shift'), k.shift()));
          !1 !== d && l(this, 'addPoint', { point: w });
          this.isDirtyData = this.isDirty = !0;
          c && n.redraw(e);
        }
        removePoint(b, c, a) {
          const e = this,
            d = e.data,
            f = d[b],
            l = e.points,
            g = e.chart,
            n = function () {
              l && l.length === d.length && l.splice(b, 1);
              d.splice(b, 1);
              e.options.data.splice(b, 1);
              e.updateParallelArrays(f || { series: e }, 'splice', [b, 1]);
              f && f.destroy();
              e.isDirty = !0;
              e.isDirtyData = !0;
              c && g.redraw();
            };
          m(a, g);
          c = E(c, !0);
          f ? f.firePointEvent('remove', null, n) : n();
        }
        remove(b, c, a, e) {
          function d() {
            f.destroy(e);
            g.isDirtyLegend = g.isDirtyBox = !0;
            g.linkSeries(e);
            E(b, !0) && g.redraw(c);
          }
          const f = this,
            g = f.chart;
          !1 !== a ? l(f, 'remove', null, d) : d();
        }
        update(c, a) {
          c = n(c, this.userOptions);
          l(this, 'update', { options: c });
          const d = this,
            f = d.chart;
          var g = d.userOptions;
          const p = d.initialType || d.type;
          var k = f.options.plotOptions;
          const h = y[p].prototype;
          var t = d.finishedAnimating && { animation: !1 };
          const m = {};
          let w,
            q = [
              'colorIndex',
              'eventOptions',
              'navigatorSeries',
              'symbolIndex',
              'baseSeries',
            ],
            v = c.type || g.type || f.options.chart.type;
          const r = !(
            this.hasDerivedData ||
            (v && v !== this.type) ||
            'undefined' !== typeof c.pointStart ||
            'undefined' !== typeof c.pointInterval ||
            'undefined' !== typeof c.relativeXValue ||
            c.joinBy ||
            c.mapData ||
            d.hasOptionChanged('dataGrouping') ||
            d.hasOptionChanged('pointStart') ||
            d.hasOptionChanged('pointInterval') ||
            d.hasOptionChanged('pointIntervalUnit') ||
            d.hasOptionChanged('keys')
          );
          v = v || p;
          r &&
            (q.push(
              'data',
              'isDirtyData',
              'points',
              'processedData',
              'processedXData',
              'processedYData',
              'xIncrement',
              'cropped',
              '_hasPointMarkers',
              '_hasPointLabels',
              'clips',
              'nodes',
              'layout',
              'level',
              'mapMap',
              'mapData',
              'minY',
              'maxY',
              'minX',
              'maxX',
            ),
            !1 !== c.visible && q.push('area', 'graph'),
            d.parallelArrays.forEach(function (b) {
              q.push(b + 'Data');
            }),
            c.data &&
              (c.dataSorting && b(d.options.dataSorting, c.dataSorting),
              this.setData(c.data, !1)));
          c = Q(
            g,
            t,
            {
              index: 'undefined' === typeof g.index ? d.index : g.index,
              pointStart: E(
                k && k.series && k.series.pointStart,
                g.pointStart,
                d.xData[0],
              ),
            },
            !r && { data: d.options.data },
            c,
          );
          r && c.data && (c.data = d.options.data);
          q = [
            'group',
            'markerGroup',
            'dataLabelsGroup',
            'transformGroup',
          ].concat(q);
          q.forEach(function (b) {
            q[b] = d[b];
            delete d[b];
          });
          k = !1;
          if (y[v]) {
            if (((k = v !== d.type), d.remove(!1, !1, !1, !0), k))
              if (Object.setPrototypeOf)
                Object.setPrototypeOf(d, y[v].prototype);
              else {
                t = Object.hasOwnProperty.call(d, 'hcEvents') && d.hcEvents;
                for (w in h) d[w] = void 0;
                b(d, y[v].prototype);
                t ? (d.hcEvents = t) : delete d.hcEvents;
              }
          } else e(17, !0, f, { missingModuleFor: v });
          q.forEach(function (b) {
            d[b] = q[b];
          });
          d.init(f, c);
          if (r && this.points) {
            c = d.options;
            if (!1 === c.visible) ((m.graphic = 1), (m.dataLabel = 1));
            else if (!d._hasPointLabels) {
              const { marker: b, dataLabels: a } = c;
              g = g.marker || {};
              !b ||
                (!1 !== b.enabled &&
                  g.symbol === b.symbol &&
                  g.height === b.height &&
                  g.width === b.width) ||
                (m.graphic = 1);
              a && !1 === a.enabled && (m.dataLabel = 1);
            }
            for (const b of this.points)
              b &&
                b.series &&
                (b.resolveColor(),
                Object.keys(m).length && b.destroyElements(m),
                !1 === c.showInLegend &&
                  b.legendItem &&
                  f.legend.destroyItem(b));
          }
          d.initialType = p;
          f.linkSeries();
          k && d.linkedSeries.length && (d.isDirtyData = !0);
          l(this, 'afterUpdate');
          E(a, !0) && f.redraw(r ? void 0 : !1);
        }
        setName(b) {
          this.name = this.options.name = this.userOptions.name = b;
          this.chart.isDirtyLegend = !0;
        }
        hasOptionChanged(b) {
          const c = this.options[b],
            a = this.chart.options.plotOptions,
            e = this.userOptions[b];
          return e
            ? c !== e
            : c !==
                E(
                  a && a[this.type] && a[this.type][b],
                  a && a.series && a.series[b],
                  c,
                );
        }
        onMouseOver() {
          const b = this.chart,
            c = b.hoverSeries;
          b.pointer.setHoverChartIndex();
          if (c && c !== this) c.onMouseOut();
          this.options.events.mouseOver && l(this, 'mouseOver');
          this.setState('hover');
          b.hoverSeries = this;
        }
        onMouseOut() {
          const b = this.options,
            c = this.chart,
            a = c.tooltip,
            e = c.hoverPoint;
          c.hoverSeries = null;
          if (e) e.onMouseOut();
          this && b.events.mouseOut && l(this, 'mouseOut');
          !a ||
            this.stickyTracking ||
            (a.shared && !this.noSharedTooltip) ||
            a.hide();
          c.series.forEach(function (b) {
            b.setState('', !0);
          });
        }
        setState(b, c) {
          const a = this;
          var e = a.options;
          const d = a.graph,
            f = e.inactiveOtherPoints,
            l = e.states,
            g = E(
              l[b || 'normal'] && l[b || 'normal'].animation,
              a.chart.options.chart.animation,
            );
          let n = e.lineWidth,
            p = 0,
            k = e.opacity;
          b = b || '';
          if (
            a.state !== b &&
            ([a.group, a.markerGroup, a.dataLabelsGroup].forEach(function (c) {
              c &&
                (a.state && c.removeClass('highcharts-series-' + a.state),
                b && c.addClass('highcharts-series-' + b));
            }),
            (a.state = b),
            !a.chart.styledMode)
          ) {
            if (l[b] && !1 === l[b].enabled) return;
            b &&
              ((n = l[b].lineWidth || n + (l[b].lineWidthPlus || 0)),
              (k = E(l[b].opacity, k)));
            if (d && !d.dashstyle && P(n))
              for (
                e = { 'stroke-width': n }, d.animate(e, g);
                a['zone-graph-' + p];
              )
                (a['zone-graph-' + p].animate(e, g), (p += 1));
            f ||
              [
                a.group,
                a.markerGroup,
                a.dataLabelsGroup,
                a.labelBySeries,
              ].forEach(function (b) {
                b && b.animate({ opacity: k }, g);
              });
          }
          c && f && a.points && a.setAllPointsToState(b || void 0);
        }
        setAllPointsToState(b) {
          this.points.forEach(function (c) {
            c.setState && c.setState(b);
          });
        }
        setVisible(b, c) {
          const a = this,
            e = a.chart,
            d = e.options.chart.ignoreHiddenSeries,
            f = a.visible,
            g = (a.visible =
              b =
              a.options.visible =
              a.userOptions.visible =
                'undefined' === typeof b ? !f : b)
              ? 'show'
              : 'hide';
          ['group', 'dataLabelsGroup', 'markerGroup', 'tracker', 'tt'].forEach(
            function (b) {
              if (a[b]) a[b][g]();
            },
          );
          if (
            e.hoverSeries === a ||
            (e.hoverPoint && e.hoverPoint.series) === a
          )
            a.onMouseOut();
          a.legendItem && e.legend.colorizeItem(a, b);
          a.isDirty = !0;
          a.options.stacking &&
            e.series.forEach(function (b) {
              b.options.stacking && b.visible && (b.isDirty = !0);
            });
          a.linkedSeries.forEach(function (c) {
            c.setVisible(b, !1);
          });
          d && (e.isDirtyBox = !0);
          l(a, g);
          !1 !== c && e.redraw();
        }
        show() {
          this.setVisible(!0);
        }
        hide() {
          this.setVisible(!1);
        }
        select(b) {
          this.selected =
            b =
            this.options.selected =
              'undefined' === typeof b ? !this.selected : b;
          this.checkbox && (this.checkbox.checked = b);
          l(this, b ? 'select' : 'unselect');
        }
        shouldShowTooltip(b, c, a = {}) {
          a.series = this;
          a.visiblePlotOnly = !0;
          return this.chart.isInsidePlot(b, c, a);
        }
        drawLegendSymbol(b, c) {
          var a;
          null === (a = C[this.options.legendSymbol || 'rectangle']) ||
          void 0 === a
            ? void 0
            : a.call(this, b, c);
        }
      }
      Y.defaultOptions = D;
      Y.types = B.seriesTypes;
      Y.registerType = B.registerSeriesType;
      b(Y.prototype, {
        axisTypes: ['xAxis', 'yAxis'],
        coll: 'series',
        colorCounter: 0,
        cropShoulder: 1,
        directTouch: !1,
        isCartesian: !0,
        kdAxisArray: ['clientX', 'plotY'],
        parallelArrays: ['x', 'y'],
        pointClass: z,
        requireSorting: !0,
        sorted: !0,
      });
      B.series = Y;
      ('');
      ('');
      return Y;
    },
  );
  M(
    a,
    'Core/Chart/Chart.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Axis/Axis.js'],
      a['Core/Defaults.js'],
      a['Core/Templating.js'],
      a['Core/Foundation.js'],
      a['Core/Globals.js'],
      a['Core/Renderer/RendererRegistry.js'],
      a['Core/Series/Series.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Renderer/SVG/SVGRenderer.js'],
      a['Core/Time.js'],
      a['Core/Utilities.js'],
      a['Core/Renderer/HTML/AST.js'],
    ],
    function (a, A, G, H, C, z, D, B, u, q, r, m, v) {
      const { animate: h, animObject: g, setAnimation: d } = a,
        { defaultOptions: k, defaultTime: y } = G,
        { numberFormat: K } = H,
        { registerEventOptions: x } = C,
        { charts: f, doc: p, marginNames: t, svg: n, win: w } = z,
        { seriesTypes: e } = u,
        {
          addEvent: b,
          attr: c,
          createElement: l,
          css: I,
          defined: F,
          diffObjects: J,
          discardElement: S,
          erase: P,
          error: O,
          extend: Q,
          find: W,
          fireEvent: E,
          getStyle: da,
          isArray: fa,
          isNumber: aa,
          isObject: Y,
          isString: N,
          merge: M,
          objectEach: R,
          pick: T,
          pInt: V,
          relativeLength: Z,
          removeEvent: ia,
          splat: ea,
          syncTimeout: ca,
          uniqueKey: ba,
        } = m;
      class U {
        static chart(b, c, a) {
          return new U(b, c, a);
        }
        constructor(b, c, a) {
          this.series =
            this.renderTo =
            this.renderer =
            this.pointer =
            this.pointCount =
            this.plotWidth =
            this.plotTop =
            this.plotLeft =
            this.plotHeight =
            this.plotBox =
            this.options =
            this.numberFormatter =
            this.margin =
            this.labelCollectors =
            this.isResizing =
            this.index =
            this.eventOptions =
            this.container =
            this.colorCounter =
            this.clipBox =
            this.chartWidth =
            this.chartHeight =
            this.bounds =
            this.axisOffset =
            this.axes =
              void 0;
          this.sharedClips = {};
          this.zooming =
            this.yAxis =
            this.xAxis =
            this.userOptions =
            this.titleOffset =
            this.time =
            this.symbolCounter =
            this.spacingBox =
            this.spacing =
              void 0;
          this.getArgs(b, c, a);
        }
        getArgs(b, c, a) {
          N(b) || b.nodeName
            ? ((this.renderTo = b), this.init(c, a))
            : this.init(b, c);
        }
        setZoomOptions() {
          const b = this.options.chart,
            c = b.zooming;
          this.zooming = Object.assign(Object.assign({}, c), {
            type: T(b.zoomType, c.type),
            key: T(b.zoomKey, c.key),
            pinchType: T(b.pinchType, c.pinchType),
            singleTouch: T(b.zoomBySingleTouch, c.singleTouch, !1),
            resetButton: M(c.resetButton, b.resetZoomButton),
          });
        }
        init(b, c) {
          E(this, 'init', { args: arguments }, function () {
            const a = M(k, b),
              e = a.chart;
            this.userOptions = Q({}, b);
            this.margin = [];
            this.spacing = [];
            this.bounds = { h: {}, v: {} };
            this.labelCollectors = [];
            this.callback = c;
            this.isResizing = 0;
            this.options = a;
            this.axes = [];
            this.series = [];
            this.time =
              b.time && Object.keys(b.time).length ? new r(b.time) : z.time;
            this.numberFormatter = e.numberFormatter || K;
            this.styledMode = e.styledMode;
            this.hasCartesianSeries = e.showAxes;
            this.index = f.length;
            f.push(this);
            z.chartCount++;
            x(this, e);
            this.xAxis = [];
            this.yAxis = [];
            this.pointCount = this.colorCounter = this.symbolCounter = 0;
            this.setZoomOptions();
            E(this, 'afterInit');
            this.firstRender();
          });
        }
        initSeries(b) {
          var c = this.options.chart;
          c = b.type || c.type;
          const a = e[c];
          a || O(17, !0, this, { missingModuleFor: c });
          c = new a();
          'function' === typeof c.init && c.init(this, b);
          return c;
        }
        setSeriesData() {
          this.getSeriesOrderByLinks().forEach(function (b) {
            b.points ||
              b.data ||
              !b.enabledDataSorting ||
              b.setData(b.options.data, !1);
          });
        }
        getSeriesOrderByLinks() {
          return this.series.concat().sort(function (b, c) {
            return b.linkedSeries.length || c.linkedSeries.length
              ? c.linkedSeries.length - b.linkedSeries.length
              : 0;
          });
        }
        orderItems(b, c = 0) {
          const a = this[b],
            e = (this.options[b] = ea(this.options[b]).slice());
          b = this.userOptions[b] = this.userOptions[b]
            ? ea(this.userOptions[b]).slice()
            : [];
          this.hasRendered && (e.splice(c), b.splice(c));
          if (a)
            for (let d = c, f = a.length; d < f; ++d)
              if ((c = a[d]))
                ((c.index = d),
                  c instanceof B && (c.name = c.getName()),
                  c.options.isInternal ||
                    ((e[d] = c.options), (b[d] = c.userOptions)));
        }
        isInsidePlot(b, c, a = {}) {
          const {
            inverted: e,
            plotBox: d,
            plotLeft: f,
            plotTop: l,
            scrollablePlotBox: g,
          } = this;
          var n = 0;
          let p = 0;
          a.visiblePlotOnly &&
            this.scrollingContainer &&
            ({ scrollLeft: n, scrollTop: p } = this.scrollingContainer);
          const k = a.series,
            h = (a.visiblePlotOnly && g) || d;
          var t = a.inverted ? c : b;
          c = a.inverted ? b : c;
          b = { x: t, y: c, isInsidePlot: !0, options: a };
          if (!a.ignoreX) {
            const c = (k && (e && !this.polar ? k.yAxis : k.xAxis)) || {
              pos: f,
              len: Infinity,
            };
            t = a.paneCoordinates ? c.pos + t : f + t;
            (t >= Math.max(n + f, c.pos) &&
              t <= Math.min(n + f + h.width, c.pos + c.len)) ||
              (b.isInsidePlot = !1);
          }
          !a.ignoreY &&
            b.isInsidePlot &&
            ((n = (!e && a.axis && !a.axis.isXAxis && a.axis) ||
              (k && (e ? k.xAxis : k.yAxis)) || { pos: l, len: Infinity }),
            (a = a.paneCoordinates ? n.pos + c : l + c),
            (a >= Math.max(p + l, n.pos) &&
              a <= Math.min(p + l + h.height, n.pos + n.len)) ||
              (b.isInsidePlot = !1));
          E(this, 'afterIsInsidePlot', b);
          return b.isInsidePlot;
        }
        redraw(b) {
          E(this, 'beforeRedraw');
          const c = this.hasCartesianSeries ? this.axes : this.colorAxis || [],
            a = this.series,
            e = this.pointer,
            f = this.legend,
            l = this.userOptions.legend,
            g = this.renderer,
            n = g.isHidden(),
            p = [];
          let k,
            h,
            t = this.isDirtyBox,
            m = this.isDirtyLegend,
            w;
          g.rootFontSize = g.boxWrapper.getStyle('font-size');
          this.setResponsive && this.setResponsive(!1);
          d(this.hasRendered ? b : !1, this);
          n && this.temporaryDisplay();
          this.layOutTitles(!1);
          for (b = a.length; b--; )
            if (((w = a[b]), w.options.stacking || w.options.centerInCategory))
              if (((h = !0), w.isDirty)) {
                k = !0;
                break;
              }
          if (k)
            for (b = a.length; b--; )
              ((w = a[b]), w.options.stacking && (w.isDirty = !0));
          a.forEach(function (b) {
            b.isDirty &&
              ('point' === b.options.legendType
                ? ('function' === typeof b.updateTotals && b.updateTotals(),
                  (m = !0))
                : l && (l.labelFormatter || l.labelFormat) && (m = !0));
            b.isDirtyData && E(b, 'updatedData');
          });
          m &&
            f &&
            f.options.enabled &&
            (f.render(), (this.isDirtyLegend = !1));
          h && this.getStacks();
          c.forEach(function (b) {
            b.updateNames();
            b.setScale();
          });
          this.getMargins();
          c.forEach(function (b) {
            b.isDirty && (t = !0);
          });
          c.forEach(function (b) {
            const c = b.min + ',' + b.max;
            b.extKey !== c &&
              ((b.extKey = c),
              p.push(function () {
                E(b, 'afterSetExtremes', Q(b.eventArgs, b.getExtremes()));
                delete b.eventArgs;
              }));
            (t || h) && b.redraw();
          });
          t && this.drawChartBox();
          E(this, 'predraw');
          a.forEach(function (b) {
            (t || b.isDirty) && b.visible && b.redraw();
            b.isDirtyData = !1;
          });
          e && e.reset(!0);
          g.draw();
          E(this, 'redraw');
          E(this, 'render');
          n && this.temporaryDisplay(!0);
          p.forEach(function (b) {
            b.call();
          });
        }
        get(b) {
          function c(c) {
            return c.id === b || (c.options && c.options.id === b);
          }
          const a = this.series;
          let e = W(this.axes, c) || W(this.series, c);
          for (let b = 0; !e && b < a.length; b++) e = W(a[b].points || [], c);
          return e;
        }
        getAxes() {
          const b = this.options;
          E(this, 'getAxes');
          for (const c of ['xAxis', 'yAxis']) {
            const a = (b[c] = ea(b[c] || {}));
            for (const b of a) new A(this, b, c);
          }
          E(this, 'afterGetAxes');
        }
        getSelectedPoints() {
          return this.series.reduce((b, c) => {
            c.getPointsCollection().forEach((c) => {
              T(c.selectedStaging, c.selected) && b.push(c);
            });
            return b;
          }, []);
        }
        getSelectedSeries() {
          return this.series.filter(function (b) {
            return b.selected;
          });
        }
        setTitle(b, c, a) {
          this.applyDescription('title', b);
          this.applyDescription('subtitle', c);
          this.applyDescription('caption', void 0);
          this.layOutTitles(a);
        }
        applyDescription(b, c) {
          const a = this,
            e = (this.options[b] = M(this.options[b], c));
          let d = this[b];
          d && c && (this[b] = d = d.destroy());
          e &&
            !d &&
            ((d = this.renderer
              .text(e.text, 0, 0, e.useHTML)
              .attr({
                align: e.align,
                class: 'highcharts-' + b,
                zIndex: e.zIndex || 4,
              })
              .add()),
            (d.update = function (c, e) {
              a.applyDescription(b, c);
              a.layOutTitles(e);
            }),
            this.styledMode ||
              d.css(
                Q(
                  'title' === b
                    ? { fontSize: this.options.isStock ? '1em' : '1.2em' }
                    : {},
                  e.style,
                ),
              ),
            (this[b] = d));
        }
        layOutTitles(b = !0) {
          const c = [0, 0, 0],
            a = this.renderer,
            e = this.spacingBox;
          ['title', 'subtitle', 'caption'].forEach(function (b) {
            const d = this[b],
              f = this.options[b],
              l = f.verticalAlign || 'top';
            b =
              'title' === b
                ? 'top' === l
                  ? -3
                  : 0
                : 'top' === l
                  ? c[0] + 2
                  : 0;
            if (d) {
              d.css({
                width: (f.width || e.width + (f.widthAdjust || 0)) + 'px',
              });
              const g = a.fontMetrics(d).b,
                n = Math.round(d.getBBox(f.useHTML).height);
              d.align(
                Q({ y: 'bottom' === l ? g : b + g, height: n }, f),
                !1,
                'spacingBox',
              );
              f.floating ||
                ('top' === l
                  ? (c[0] = Math.ceil(c[0] + n))
                  : 'bottom' === l && (c[2] = Math.ceil(c[2] + n)));
            }
          }, this);
          c[0] &&
            'top' === (this.options.title.verticalAlign || 'top') &&
            (c[0] += this.options.title.margin);
          c[2] &&
            'bottom' === this.options.caption.verticalAlign &&
            (c[2] += this.options.caption.margin);
          const d =
            !this.titleOffset || this.titleOffset.join(',') !== c.join(',');
          this.titleOffset = c;
          E(this, 'afterLayOutTitles');
          !this.isDirtyBox &&
            d &&
            ((this.isDirtyBox = this.isDirtyLegend = d),
            this.hasRendered && b && this.isDirtyBox && this.redraw());
        }
        getContainerBox() {
          return {
            width: da(this.renderTo, 'width', !0) || 0,
            height: da(this.renderTo, 'height', !0) || 0,
          };
        }
        getChartSize() {
          var b = this.options.chart;
          const c = b.width;
          b = b.height;
          const a = this.getContainerBox();
          this.chartWidth = Math.max(0, c || a.width || 600);
          this.chartHeight = Math.max(
            0,
            Z(b, this.chartWidth) || (1 < a.height ? a.height : 400),
          );
          this.containerBox = a;
        }
        temporaryDisplay(b) {
          let c = this.renderTo;
          if (b)
            for (; c && c.style; )
              (c.hcOrigStyle && (I(c, c.hcOrigStyle), delete c.hcOrigStyle),
                c.hcOrigDetached &&
                  (p.body.removeChild(c), (c.hcOrigDetached = !1)),
                (c = c.parentNode));
          else
            for (; c && c.style; ) {
              p.body.contains(c) ||
                c.parentNode ||
                ((c.hcOrigDetached = !0), p.body.appendChild(c));
              if ('none' === da(c, 'display', !1) || c.hcOricDetached)
                ((c.hcOrigStyle = {
                  display: c.style.display,
                  height: c.style.height,
                  overflow: c.style.overflow,
                }),
                  (b = { display: 'block', overflow: 'hidden' }),
                  c !== this.renderTo && (b.height = 0),
                  I(c, b),
                  c.offsetWidth ||
                    c.style.setProperty('display', 'block', 'important'));
              c = c.parentNode;
              if (c === p.body) break;
            }
        }
        setClassName(b) {
          this.container.className = 'highcharts-container ' + (b || '');
        }
        getContainer() {
          const b = this.options,
            a = b.chart;
          var e = ba();
          let g,
            k = this.renderTo;
          k || (this.renderTo = k = a.renderTo);
          N(k) && (this.renderTo = k = p.getElementById(k));
          k || O(13, !0, this);
          var h = V(c(k, 'data-highcharts-chart'));
          aa(h) && f[h] && f[h].hasRendered && f[h].destroy();
          c(k, 'data-highcharts-chart', this.index);
          k.innerHTML = v.emptyHTML;
          a.skipClone || k.offsetWidth || this.temporaryDisplay();
          this.getChartSize();
          h = this.chartWidth;
          const t = this.chartHeight;
          I(k, { overflow: 'hidden' });
          this.styledMode ||
            (g = Q(
              {
                position: 'relative',
                overflow: 'hidden',
                width: h + 'px',
                height: t + 'px',
                textAlign: 'left',
                lineHeight: 'normal',
                zIndex: 0,
                '-webkit-tap-highlight-color': 'rgba(0,0,0,0)',
                userSelect: 'none',
                'touch-action': 'manipulation',
                outline: 'none',
              },
              a.style || {},
            ));
          this.container = e = l('div', { id: e }, g, k);
          this._cursor = e.style.cursor;
          this.renderer = new (
            a.renderer || !n ? D.getRendererType(a.renderer) : q
          )(
            e,
            h,
            t,
            void 0,
            a.forExport,
            b.exporting && b.exporting.allowHTML,
            this.styledMode,
          );
          this.containerBox = this.getContainerBox();
          d(void 0, this);
          this.setClassName(a.className);
          if (this.styledMode)
            for (const c in b.defs) this.renderer.definition(b.defs[c]);
          else this.renderer.setStyle(a.style);
          this.renderer.chartIndex = this.index;
          E(this, 'afterGetContainer');
        }
        getMargins(b) {
          const { spacing: c, margin: a, titleOffset: e } = this;
          this.resetMargins();
          e[0] &&
            !F(a[0]) &&
            (this.plotTop = Math.max(this.plotTop, e[0] + c[0]));
          e[2] &&
            !F(a[2]) &&
            (this.marginBottom = Math.max(this.marginBottom, e[2] + c[2]));
          this.legend && this.legend.display && this.legend.adjustMargins(a, c);
          E(this, 'getMargins');
          b || this.getAxisMargins();
        }
        getAxisMargins() {
          const b = this,
            c = (b.axisOffset = [0, 0, 0, 0]),
            a = b.colorAxis,
            e = b.margin,
            d = function (b) {
              b.forEach(function (b) {
                b.visible && b.getOffset();
              });
            };
          b.hasCartesianSeries ? d(b.axes) : a && a.length && d(a);
          t.forEach(function (a, d) {
            F(e[d]) || (b[a] += c[d]);
          });
          b.setChartSize();
        }
        getOptions() {
          return J(this.userOptions, k);
        }
        reflow(b) {
          const c = this;
          var a = c.options.chart;
          a = F(a.width) && F(a.height);
          const e = c.containerBox,
            d = c.getContainerBox();
          delete c.pointer.chartPosition;
          if (!a && !c.isPrinting && e && d.width) {
            if (d.width !== e.width || d.height !== e.height)
              (m.clearTimeout(c.reflowTimeout),
                (c.reflowTimeout = ca(
                  function () {
                    c.container && c.setSize(void 0, void 0, !1);
                  },
                  b ? 100 : 0,
                )));
            c.containerBox = d;
          }
        }
        setReflow() {
          const c = this;
          var a = (b) => {
            var a;
            (null === (a = c.options) || void 0 === a ? 0 : a.chart.reflow) &&
              c.hasLoaded &&
              c.reflow(b);
          };
          'function' === typeof ResizeObserver
            ? new ResizeObserver(a).observe(c.renderTo)
            : ((a = b(w, 'resize', a)), b(this, 'destroy', a));
        }
        setSize(b, c, a) {
          const e = this,
            f = e.renderer;
          e.isResizing += 1;
          d(a, e);
          a = f.globalAnimation;
          e.oldChartHeight = e.chartHeight;
          e.oldChartWidth = e.chartWidth;
          'undefined' !== typeof b && (e.options.chart.width = b);
          'undefined' !== typeof c && (e.options.chart.height = c);
          e.getChartSize();
          e.styledMode ||
            (a ? h : I)(
              e.container,
              { width: e.chartWidth + 'px', height: e.chartHeight + 'px' },
              a,
            );
          e.setChartSize(!0);
          f.setSize(e.chartWidth, e.chartHeight, a);
          e.axes.forEach(function (b) {
            b.isDirty = !0;
            b.setScale();
          });
          e.isDirtyLegend = !0;
          e.isDirtyBox = !0;
          e.layOutTitles();
          e.getMargins();
          e.redraw(a);
          e.oldChartHeight = null;
          E(e, 'resize');
          ca(function () {
            e &&
              E(e, 'endResize', null, function () {
                --e.isResizing;
              });
          }, g(a).duration);
        }
        setChartSize(b) {
          var c = this.inverted;
          const a = this.renderer;
          var e = this.chartWidth,
            d = this.chartHeight;
          const f = this.options.chart,
            l = this.spacing,
            g = this.clipOffset;
          let n, p, k, h;
          this.plotLeft = n = Math.round(this.plotLeft);
          this.plotTop = p = Math.round(this.plotTop);
          this.plotWidth = k = Math.max(
            0,
            Math.round(e - n - this.marginRight),
          );
          this.plotHeight = h = Math.max(
            0,
            Math.round(d - p - this.marginBottom),
          );
          this.plotSizeX = c ? h : k;
          this.plotSizeY = c ? k : h;
          this.plotBorderWidth = f.plotBorderWidth || 0;
          this.spacingBox = a.spacingBox = {
            x: l[3],
            y: l[0],
            width: e - l[3] - l[1],
            height: d - l[0] - l[2],
          };
          this.plotBox = a.plotBox = { x: n, y: p, width: k, height: h };
          c = 2 * Math.floor(this.plotBorderWidth / 2);
          e = Math.ceil(Math.max(c, g[3]) / 2);
          d = Math.ceil(Math.max(c, g[0]) / 2);
          this.clipBox = {
            x: e,
            y: d,
            width: Math.floor(this.plotSizeX - Math.max(c, g[1]) / 2 - e),
            height: Math.max(
              0,
              Math.floor(this.plotSizeY - Math.max(c, g[2]) / 2 - d),
            ),
          };
          b ||
            (this.axes.forEach(function (b) {
              b.setAxisSize();
              b.setAxisTranslation();
            }),
            a.alignElements());
          E(this, 'afterSetChartSize', { skipAxes: b });
        }
        resetMargins() {
          E(this, 'resetMargins');
          const b = this,
            c = b.options.chart;
          ['margin', 'spacing'].forEach(function (a) {
            const e = c[a],
              d = Y(e) ? e : [e, e, e, e];
            ['Top', 'Right', 'Bottom', 'Left'].forEach(function (e, f) {
              b[a][f] = T(c[a + e], d[f]);
            });
          });
          t.forEach(function (c, a) {
            b[c] = T(b.margin[a], b.spacing[a]);
          });
          b.axisOffset = [0, 0, 0, 0];
          b.clipOffset = [0, 0, 0, 0];
        }
        drawChartBox() {
          const b = this.options.chart,
            c = this.renderer,
            a = this.chartWidth,
            e = this.chartHeight,
            d = this.styledMode,
            f = this.plotBGImage;
          var l = b.backgroundColor;
          const g = b.plotBackgroundColor,
            n = b.plotBackgroundImage,
            p = this.plotLeft,
            k = this.plotTop,
            h = this.plotWidth,
            t = this.plotHeight,
            m = this.plotBox,
            w = this.clipRect,
            q = this.clipBox;
          let v = this.chartBackground,
            r = this.plotBackground,
            y = this.plotBorder,
            I,
            F,
            J = 'animate';
          v ||
            ((this.chartBackground = v =
              c.rect().addClass('highcharts-background').add()),
            (J = 'attr'));
          if (d) I = F = v.strokeWidth();
          else {
            I = b.borderWidth || 0;
            F = I + (b.shadow ? 8 : 0);
            l = { fill: l || 'none' };
            if (I || v['stroke-width'])
              ((l.stroke = b.borderColor), (l['stroke-width'] = I));
            v.attr(l).shadow(b.shadow);
          }
          v[J]({
            x: F / 2,
            y: F / 2,
            width: a - F - (I % 2),
            height: e - F - (I % 2),
            r: b.borderRadius,
          });
          J = 'animate';
          r ||
            ((J = 'attr'),
            (this.plotBackground = r =
              c.rect().addClass('highcharts-plot-background').add()));
          r[J](m);
          d ||
            (r.attr({ fill: g || 'none' }).shadow(b.plotShadow),
            n &&
              (f
                ? (n !== f.attr('href') && f.attr('href', n), f.animate(m))
                : (this.plotBGImage = c.image(n, p, k, h, t).add())));
          w
            ? w.animate({ width: q.width, height: q.height })
            : (this.clipRect = c.clipRect(q));
          J = 'animate';
          y ||
            ((J = 'attr'),
            (this.plotBorder = y =
              c
                .rect()
                .addClass('highcharts-plot-border')
                .attr({ zIndex: 1 })
                .add()));
          d ||
            y.attr({
              stroke: b.plotBorderColor,
              'stroke-width': b.plotBorderWidth || 0,
              fill: 'none',
            });
          y[J](y.crisp({ x: p, y: k, width: h, height: t }, -y.strokeWidth()));
          this.isDirtyBox = !1;
          E(this, 'afterDrawChartBox');
        }
        propFromSeries() {
          const b = this,
            c = b.options.chart,
            a = b.options.series;
          let d, f, l;
          ['inverted', 'angular', 'polar'].forEach(function (g) {
            f = e[c.type];
            l = c[g] || (f && f.prototype[g]);
            for (d = a && a.length; !l && d--; )
              (f = e[a[d].type]) && f.prototype[g] && (l = !0);
            b[g] = l;
          });
        }
        linkSeries(b) {
          const c = this,
            a = c.series;
          a.forEach(function (b) {
            b.linkedSeries.length = 0;
          });
          a.forEach(function (b) {
            let a = b.options.linkedTo;
            N(a) &&
              (a = ':previous' === a ? c.series[b.index - 1] : c.get(a)) &&
              a.linkedParent !== b &&
              (a.linkedSeries.push(b),
              (b.linkedParent = a),
              a.enabledDataSorting && b.setDataSortingOptions(),
              (b.visible = T(b.options.visible, a.options.visible, b.visible)));
          });
          E(this, 'afterLinkSeries', { isUpdating: b });
        }
        renderSeries() {
          this.series.forEach(function (b) {
            b.translate();
            b.render();
          });
        }
        render() {
          const b = this.axes,
            c = this.colorAxis,
            a = this.renderer,
            e = function (b) {
              b.forEach(function (b) {
                b.visible && b.render();
              });
            };
          let d = 0;
          this.setTitle();
          E(this, 'beforeMargins');
          this.getStacks && this.getStacks();
          this.getMargins(!0);
          this.setChartSize();
          const f = this.plotWidth;
          b.some(function (b) {
            if (
              b.horiz &&
              b.visible &&
              b.options.labels.enabled &&
              b.series.length
            )
              return ((d = 21), !0);
          });
          const l = (this.plotHeight = Math.max(this.plotHeight - d, 0));
          b.forEach(function (b) {
            b.setScale();
          });
          this.getAxisMargins();
          const g = 1.1 < f / this.plotWidth,
            n = 1.05 < l / this.plotHeight;
          if (g || n)
            (b.forEach(function (b) {
              ((b.horiz && g) || (!b.horiz && n)) && b.setTickInterval(!0);
            }),
              this.getMargins());
          this.drawChartBox();
          this.hasCartesianSeries ? e(b) : c && c.length && e(c);
          this.seriesGroup ||
            (this.seriesGroup = a
              .g('series-group')
              .attr({ zIndex: 3 })
              .shadow(this.options.chart.seriesGroupShadow)
              .add());
          this.renderSeries();
          this.addCredits();
          this.setResponsive && this.setResponsive();
          this.hasRendered = !0;
        }
        addCredits(b) {
          const c = this,
            a = M(!0, this.options.credits, b);
          a.enabled &&
            !this.credits &&
            ((this.credits = this.renderer
              .text(a.text + (this.mapCredits || ''), 0, 0)
              .addClass('highcharts-credits')
              .on('click', function () {
                a.href && (w.location.href = a.href);
              })
              .attr({ align: a.position.align, zIndex: 8 })),
            c.styledMode || this.credits.css(a.style),
            this.credits.add().align(a.position),
            (this.credits.update = function (b) {
              c.credits = c.credits.destroy();
              c.addCredits(b);
            }));
        }
        destroy() {
          const b = this,
            c = b.axes,
            a = b.series,
            e = b.container,
            d = e && e.parentNode;
          let l;
          E(b, 'destroy');
          b.renderer.forExport ? P(f, b) : (f[b.index] = void 0);
          z.chartCount--;
          b.renderTo.removeAttribute('data-highcharts-chart');
          ia(b);
          for (l = c.length; l--; ) c[l] = c[l].destroy();
          this.scroller && this.scroller.destroy && this.scroller.destroy();
          for (l = a.length; l--; ) a[l] = a[l].destroy();
          'title subtitle chartBackground plotBackground plotBGImage plotBorder seriesGroup clipRect credits pointer rangeSelector legend resetZoomButton tooltip renderer'
            .split(' ')
            .forEach(function (c) {
              const a = b[c];
              a && a.destroy && (b[c] = a.destroy());
            });
          e && ((e.innerHTML = v.emptyHTML), ia(e), d && S(e));
          R(b, function (c, a) {
            delete b[a];
          });
        }
        firstRender() {
          const b = this,
            c = b.options;
          b.getContainer();
          b.resetMargins();
          b.setChartSize();
          b.propFromSeries();
          b.getAxes();
          const a = fa(c.series) ? c.series : [];
          c.series = [];
          a.forEach(function (c) {
            b.initSeries(c);
          });
          b.linkSeries();
          b.setSeriesData();
          E(b, 'beforeRender');
          b.render();
          b.pointer.getChartPosition();
          if (!b.renderer.imgCount && !b.hasLoaded) b.onload();
          b.temporaryDisplay(!0);
        }
        onload() {
          this.callbacks.concat([this.callback]).forEach(function (b) {
            b && 'undefined' !== typeof this.index && b.apply(this, [this]);
          }, this);
          E(this, 'load');
          E(this, 'render');
          F(this.index) && this.setReflow();
          this.warnIfA11yModuleNotLoaded();
          this.hasLoaded = !0;
        }
        warnIfA11yModuleNotLoaded() {
          const { options: b, title: c } = this;
          b &&
            !this.accessibility &&
            (this.renderer.boxWrapper.attr({
              role: 'img',
              'aria-label': ((c && c.element.textContent) || '').replace(
                /</g,
                '&lt;',
              ),
            }),
            (b.accessibility && !1 === b.accessibility.enabled) ||
              O(
                'Highcharts warning: Consider including the "accessibility.js" module to make your chart more usable for people with disabilities. Set the "accessibility.enabled" option to false to remove this warning. See https://www.highcharts.com/docs/accessibility/accessibility-module.',
                !1,
                this,
              ));
        }
        addSeries(b, c, a) {
          const e = this;
          let d;
          b &&
            ((c = T(c, !0)),
            E(e, 'addSeries', { options: b }, function () {
              d = e.initSeries(b);
              e.isDirtyLegend = !0;
              e.linkSeries();
              d.enabledDataSorting && d.setData(b.data, !1);
              E(e, 'afterAddSeries', { series: d });
              c && e.redraw(a);
            }));
          return d;
        }
        addAxis(b, c, a, e) {
          return this.createAxis(c ? 'xAxis' : 'yAxis', {
            axis: b,
            redraw: a,
            animation: e,
          });
        }
        addColorAxis(b, c, a) {
          return this.createAxis('colorAxis', {
            axis: b,
            redraw: c,
            animation: a,
          });
        }
        createAxis(b, c) {
          b = new A(this, c.axis, b);
          T(c.redraw, !0) && this.redraw(c.animation);
          return b;
        }
        showLoading(c) {
          const a = this,
            e = a.options,
            d = e.loading,
            f = function () {
              g &&
                I(g, {
                  left: a.plotLeft + 'px',
                  top: a.plotTop + 'px',
                  width: a.plotWidth + 'px',
                  height: a.plotHeight + 'px',
                });
            };
          let g = a.loadingDiv,
            n = a.loadingSpan;
          g ||
            (a.loadingDiv = g =
              l(
                'div',
                { className: 'highcharts-loading highcharts-loading-hidden' },
                null,
                a.container,
              ));
          n ||
            ((a.loadingSpan = n =
              l('span', { className: 'highcharts-loading-inner' }, null, g)),
            b(a, 'redraw', f));
          g.className = 'highcharts-loading';
          v.setElementHTML(n, T(c, e.lang.loading, ''));
          a.styledMode ||
            (I(g, Q(d.style, { zIndex: 10 })),
            I(n, d.labelStyle),
            a.loadingShown ||
              (I(g, { opacity: 0, display: '' }),
              h(
                g,
                { opacity: d.style.opacity || 0.5 },
                { duration: d.showDuration || 0 },
              )));
          a.loadingShown = !0;
          f();
        }
        hideLoading() {
          const b = this.options,
            c = this.loadingDiv;
          c &&
            ((c.className = 'highcharts-loading highcharts-loading-hidden'),
            this.styledMode ||
              h(
                c,
                { opacity: 0 },
                {
                  duration: b.loading.hideDuration || 100,
                  complete: function () {
                    I(c, { display: 'none' });
                  },
                },
              ));
          this.loadingShown = !1;
        }
        update(b, c, a, e) {
          const d = this,
            f = {
              credits: 'addCredits',
              title: 'setTitle',
              subtitle: 'setSubtitle',
              caption: 'setCaption',
            },
            l = b.isResponsiveOptions,
            g = [];
          let n, p;
          E(d, 'update', { options: b });
          l || d.setResponsive(!1, !0);
          b = J(b, d.options);
          d.userOptions = M(d.userOptions, b);
          var k = b.chart;
          if (k) {
            M(!0, d.options.chart, k);
            this.setZoomOptions();
            'className' in k && d.setClassName(k.className);
            if ('inverted' in k || 'polar' in k || 'type' in k) {
              d.propFromSeries();
              var h = !0;
            }
            'alignTicks' in k && (h = !0);
            'events' in k && x(this, k);
            R(k, function (b, c) {
              -1 !== d.propsRequireUpdateSeries.indexOf('chart.' + c) &&
                (n = !0);
              -1 !== d.propsRequireDirtyBox.indexOf(c) && (d.isDirtyBox = !0);
              -1 !== d.propsRequireReflow.indexOf(c) &&
                (l ? (d.isDirtyBox = !0) : (p = !0));
            });
            !d.styledMode &&
              k.style &&
              d.renderer.setStyle(d.options.chart.style || {});
          }
          !d.styledMode && b.colors && (this.options.colors = b.colors);
          b.time &&
            (this.time === y && (this.time = new r(b.time)),
            M(!0, d.options.time, b.time));
          R(b, function (c, a) {
            if (d[a] && 'function' === typeof d[a].update) d[a].update(c, !1);
            else if ('function' === typeof d[f[a]]) d[f[a]](c);
            else
              'colors' !== a &&
                -1 === d.collectionsWithUpdate.indexOf(a) &&
                M(!0, d.options[a], b[a]);
            'chart' !== a &&
              -1 !== d.propsRequireUpdateSeries.indexOf(a) &&
              (n = !0);
          });
          this.collectionsWithUpdate.forEach(function (c) {
            b[c] &&
              (ea(b[c]).forEach(function (b, e) {
                const f = F(b.id);
                let l;
                f && (l = d.get(b.id));
                !l &&
                  d[c] &&
                  (l = d[c][T(b.index, e)]) &&
                  ((f && F(l.options.id)) || l.options.isInternal) &&
                  (l = void 0);
                l && l.coll === c && (l.update(b, !1), a && (l.touched = !0));
                !l &&
                  a &&
                  d.collectionsWithInit[c] &&
                  (d.collectionsWithInit[c][0].apply(
                    d,
                    [b].concat(d.collectionsWithInit[c][1] || []).concat([!1]),
                  ).touched = !0);
              }),
              a &&
                d[c].forEach(function (b) {
                  b.touched || b.options.isInternal
                    ? delete b.touched
                    : g.push(b);
                }));
          });
          g.forEach(function (b) {
            b.chart && b.remove && b.remove(!1);
          });
          h &&
            d.axes.forEach(function (b) {
              b.update({}, !1);
            });
          n &&
            d.getSeriesOrderByLinks().forEach(function (b) {
              b.chart && b.update({}, !1);
            }, this);
          h = k && k.width;
          k = k && (N(k.height) ? Z(k.height, h || d.chartWidth) : k.height);
          p || (aa(h) && h !== d.chartWidth) || (aa(k) && k !== d.chartHeight)
            ? d.setSize(h, k, e)
            : T(c, !0) && d.redraw(e);
          E(d, 'afterUpdate', { options: b, redraw: c, animation: e });
        }
        setSubtitle(b, c) {
          this.applyDescription('subtitle', b);
          this.layOutTitles(c);
        }
        setCaption(b, c) {
          this.applyDescription('caption', b);
          this.layOutTitles(c);
        }
        showResetZoom() {
          function b() {
            c.zoomOut();
          }
          const c = this,
            a = k.lang,
            e = c.zooming.resetButton,
            d = e.theme,
            f =
              'chart' === e.relativeTo || 'spacingBox' === e.relativeTo
                ? null
                : 'scrollablePlotBox';
          E(this, 'beforeShowResetZoom', null, function () {
            c.resetZoomButton = c.renderer
              .button(a.resetZoom, null, null, b, d)
              .attr({ align: e.position.align, title: a.resetZoomTitle })
              .addClass('highcharts-reset-zoom')
              .add()
              .align(e.position, !1, f);
          });
          E(this, 'afterShowResetZoom');
        }
        zoomOut() {
          E(this, 'selection', { resetSelection: !0 }, this.zoom);
        }
        zoom(b) {
          const c = this,
            a = c.pointer;
          let e = !1,
            d;
          !b || b.resetSelection
            ? (c.axes.forEach(function (b) {
                d = b.zoom();
              }),
              (a.initiated = !1))
            : b.xAxis.concat(b.yAxis).forEach(function (b) {
                const f = b.axis;
                if (
                  (a[f.isXAxis ? 'zoomX' : 'zoomY'] &&
                    F(a.mouseDownX) &&
                    F(a.mouseDownY) &&
                    c.isInsidePlot(
                      a.mouseDownX - c.plotLeft,
                      a.mouseDownY - c.plotTop,
                      { axis: f },
                    )) ||
                  !F(c.inverted ? a.mouseDownX : a.mouseDownY)
                )
                  ((d = f.zoom(b.min, b.max)), f.displayBtn && (e = !0));
              });
          const f = c.resetZoomButton;
          e && !f
            ? c.showResetZoom()
            : !e && Y(f) && (c.resetZoomButton = f.destroy());
          d &&
            c.redraw(
              T(
                c.options.chart.animation,
                b && b.animation,
                100 > c.pointCount,
              ),
            );
        }
        pan(b, c) {
          const a = this,
            e = a.hoverPoints;
          c = 'object' === typeof c ? c : { enabled: c, type: 'x' };
          const d = a.options.chart;
          d && d.panning && (d.panning = c);
          const f = c.type;
          let l;
          E(this, 'pan', { originalEvent: b }, function () {
            e &&
              e.forEach(function (b) {
                b.setState();
              });
            let c = a.xAxis;
            'xy' === f ? (c = c.concat(a.yAxis)) : 'y' === f && (c = a.yAxis);
            const d = {};
            c.forEach(function (c) {
              if (c.options.panningEnabled && !c.options.isInternal) {
                var e = c.horiz,
                  g = b[e ? 'chartX' : 'chartY'];
                e = e ? 'mouseDownX' : 'mouseDownY';
                var n = a[e],
                  p = c.minPointOffset || 0,
                  k =
                    (c.reversed && !a.inverted) || (!c.reversed && a.inverted)
                      ? -1
                      : 1,
                  h = c.getExtremes(),
                  t = c.toValue(n - g, !0) + p * k,
                  m =
                    c.toValue(n + c.len - g, !0) -
                    (p * k || (c.isXAxis && c.pointRangePadding) || 0),
                  w = m < t;
                k = c.hasVerticalPanning();
                n = w ? m : t;
                t = w ? t : m;
                var q = c.panningState;
                !k ||
                  c.isXAxis ||
                  (q && !q.isDirty) ||
                  c.series.forEach(function (b) {
                    var c = b.getProcessedData(!0);
                    c = b.getExtremes(c.yData, !0);
                    q ||
                      (q = {
                        startMin: Number.MAX_VALUE,
                        startMax: -Number.MAX_VALUE,
                      });
                    aa(c.dataMin) &&
                      aa(c.dataMax) &&
                      ((q.startMin = Math.min(
                        T(b.options.threshold, Infinity),
                        c.dataMin,
                        q.startMin,
                      )),
                      (q.startMax = Math.max(
                        T(b.options.threshold, -Infinity),
                        c.dataMax,
                        q.startMax,
                      )));
                  });
                k = Math.min(
                  T(q && q.startMin, h.dataMin),
                  p ? h.min : c.toValue(c.toPixels(h.min) - c.minPixelPadding),
                );
                m = Math.max(
                  T(q && q.startMax, h.dataMax),
                  p ? h.max : c.toValue(c.toPixels(h.max) + c.minPixelPadding),
                );
                c.panningState = q;
                c.isOrdinal ||
                  ((p = k - n),
                  0 < p && ((t += p), (n = k)),
                  (p = t - m),
                  0 < p && ((t = m), (n -= p)),
                  c.series.length &&
                    n !== h.min &&
                    t !== h.max &&
                    n >= k &&
                    t <= m &&
                    (c.setExtremes(n, t, !1, !1, { trigger: 'pan' }),
                    !a.resetZoomButton &&
                      n !== k &&
                      t !== m &&
                      f.match('y') &&
                      (a.showResetZoom(), (c.displayBtn = !1)),
                    (l = !0)),
                  (d[e] = g));
              }
            });
            R(d, (b, c) => {
              a[c] = b;
            });
            l && a.redraw(!1);
            I(a.container, { cursor: 'move' });
          });
        }
      }
      Q(U.prototype, {
        callbacks: [],
        collectionsWithInit: {
          xAxis: [U.prototype.addAxis, [!0]],
          yAxis: [U.prototype.addAxis, [!1]],
          series: [U.prototype.addSeries],
        },
        collectionsWithUpdate: ['xAxis', 'yAxis', 'series'],
        propsRequireDirtyBox:
          'backgroundColor borderColor borderWidth borderRadius plotBackgroundColor plotBackgroundImage plotBorderColor plotBorderWidth plotShadow shadow'.split(
            ' ',
          ),
        propsRequireReflow:
          'margin marginTop marginRight marginBottom marginLeft spacing spacingTop spacingRight spacingBottom spacingLeft'.split(
            ' ',
          ),
        propsRequireUpdateSeries:
          'chart.inverted chart.polar chart.ignoreHiddenSeries chart.type colors plotOptions time tooltip'.split(
            ' ',
          ),
      });
      ('');
      return U;
    },
  );
  M(
    a,
    'Extensions/ScrollablePlotArea.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Axis/Axis.js'],
      a['Core/Chart/Chart.js'],
      a['Core/Series/Series.js'],
      a['Core/Renderer/RendererRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z) {
      const { stop: x } = a,
        { addEvent: B, createElement: u, defined: q, merge: r, pick: m } = z;
      B(G, 'afterSetChartSize', function (a) {
        var h = this.options.chart.scrollablePlotArea,
          g = h && h.minWidth;
        h = h && h.minHeight;
        let d;
        if (!this.renderer.forExport) {
          if (g) {
            if ((this.scrollablePixelsX = g = Math.max(0, g - this.chartWidth)))
              ((this.scrollablePlotBox = this.renderer.scrollablePlotBox =
                r(this.plotBox)),
                (this.plotBox.width = this.plotWidth += g),
                this.inverted
                  ? (this.clipBox.height += g)
                  : (this.clipBox.width += g),
                (d = { 1: { name: 'right', value: g } }));
          } else
            h &&
              ((this.scrollablePixelsY = g = Math.max(0, h - this.chartHeight)),
              q(g) &&
                ((this.scrollablePlotBox = this.renderer.scrollablePlotBox =
                  r(this.plotBox)),
                (this.plotBox.height = this.plotHeight += g),
                this.inverted
                  ? (this.clipBox.width += g)
                  : (this.clipBox.height += g),
                (d = { 2: { name: 'bottom', value: g } })));
          d &&
            !a.skipAxes &&
            this.axes.forEach(function (a) {
              d[a.side]
                ? (a.getPlotLinePath = function () {
                    let g = d[a.side].name,
                      k = this[g],
                      h;
                    this[g] = k - d[a.side].value;
                    h = A.prototype.getPlotLinePath.apply(this, arguments);
                    this[g] = k;
                    return h;
                  })
                : (a.setAxisSize(), a.setAxisTranslation());
            });
        }
      });
      B(G, 'render', function () {
        this.scrollablePixelsX || this.scrollablePixelsY
          ? (this.setUpScrolling && this.setUpScrolling(), this.applyFixed())
          : this.fixedDiv && this.applyFixed();
      });
      G.prototype.setUpScrolling = function () {
        const a = {
          WebkitOverflowScrolling: 'touch',
          overflowX: 'hidden',
          overflowY: 'hidden',
        };
        this.scrollablePixelsX && (a.overflowX = 'auto');
        this.scrollablePixelsY && (a.overflowY = 'auto');
        this.scrollingParent = u(
          'div',
          { className: 'highcharts-scrolling-parent' },
          { position: 'relative' },
          this.renderTo,
        );
        this.scrollingContainer = u(
          'div',
          { className: 'highcharts-scrolling' },
          a,
          this.scrollingParent,
        );
        let h;
        B(this.scrollingContainer, 'scroll', () => {
          this.pointer &&
            (delete this.pointer.chartPosition,
            this.hoverPoint && (h = this.hoverPoint),
            this.pointer.runPointActions(void 0, h, !0));
        });
        this.innerContainer = u(
          'div',
          { className: 'highcharts-inner-container' },
          null,
          this.scrollingContainer,
        );
        this.innerContainer.appendChild(this.container);
        this.setUpScrolling = null;
      };
      G.prototype.moveFixedElements = function () {
        let a = this.container,
          h = this.fixedRenderer,
          g =
            '.highcharts-breadcrumbs-group .highcharts-contextbutton .highcharts-credits .highcharts-legend .highcharts-legend-checkbox .highcharts-navigator-series .highcharts-navigator-xaxis .highcharts-navigator-yaxis .highcharts-navigator .highcharts-reset-zoom .highcharts-drillup-button .highcharts-scrollbar .highcharts-subtitle .highcharts-title'.split(
              ' ',
            ),
          d;
        this.scrollablePixelsX && !this.inverted
          ? (d = '.highcharts-yaxis')
          : this.scrollablePixelsX && this.inverted
            ? (d = '.highcharts-xaxis')
            : this.scrollablePixelsY && !this.inverted
              ? (d = '.highcharts-xaxis')
              : this.scrollablePixelsY &&
                this.inverted &&
                (d = '.highcharts-yaxis');
        d &&
          g.push(
            `${d}:not(.highcharts-radial-axis)`,
            `${d}-labels:not(.highcharts-radial-axis-labels)`,
          );
        g.forEach(function (d) {
          [].forEach.call(a.querySelectorAll(d), function (a) {
            (a.namespaceURI === h.SVG_NS
              ? h.box
              : h.box.parentNode
            ).appendChild(a);
            a.style.pointerEvents = 'auto';
          });
        });
      };
      G.prototype.applyFixed = function () {
        var a = !this.fixedDiv,
          h = this.options.chart,
          g = h.scrollablePlotArea,
          d = C.getRendererType();
        a
          ? ((this.fixedDiv = u(
              'div',
              { className: 'highcharts-fixed' },
              {
                position: 'absolute',
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: ((h.style && h.style.zIndex) || 0) + 2,
                top: 0,
              },
              null,
              !0,
            )),
            this.scrollingContainer &&
              this.scrollingContainer.parentNode.insertBefore(
                this.fixedDiv,
                this.scrollingContainer,
              ),
            (this.renderTo.style.overflow = 'visible'),
            (this.fixedRenderer = h =
              new d(
                this.fixedDiv,
                this.chartWidth,
                this.chartHeight,
                this.options.chart.style,
              )),
            (this.scrollableMask = h
              .path()
              .attr({
                fill: this.options.chart.backgroundColor || '#fff',
                'fill-opacity': m(g.opacity, 0.85),
                zIndex: -1,
              })
              .addClass('highcharts-scrollable-mask')
              .add()),
            B(this, 'afterShowResetZoom', this.moveFixedElements),
            B(this, 'afterApplyDrilldown', this.moveFixedElements),
            B(this, 'afterLayOutTitles', this.moveFixedElements))
          : this.fixedRenderer.setSize(this.chartWidth, this.chartHeight);
        if (this.scrollableDirty || a)
          ((this.scrollableDirty = !1), this.moveFixedElements());
        h = this.chartWidth + (this.scrollablePixelsX || 0);
        d = this.chartHeight + (this.scrollablePixelsY || 0);
        x(this.container);
        this.container.style.width = h + 'px';
        this.container.style.height = d + 'px';
        this.renderer.boxWrapper.attr({
          width: h,
          height: d,
          viewBox: [0, 0, h, d].join(' '),
        });
        this.chartBackground.attr({ width: h, height: d });
        this.scrollingContainer.style.height = this.chartHeight + 'px';
        a &&
          (g.scrollPositionX &&
            (this.scrollingContainer.scrollLeft =
              this.scrollablePixelsX * g.scrollPositionX),
          g.scrollPositionY &&
            (this.scrollingContainer.scrollTop =
              this.scrollablePixelsY * g.scrollPositionY));
        d = this.axisOffset;
        a = this.plotTop - d[0] - 1;
        g = this.plotLeft - d[3] - 1;
        h = this.plotTop + this.plotHeight + d[2] + 1;
        d = this.plotLeft + this.plotWidth + d[1] + 1;
        let k = this.plotLeft + this.plotWidth - (this.scrollablePixelsX || 0),
          q = this.plotTop + this.plotHeight - (this.scrollablePixelsY || 0);
        a = this.scrollablePixelsX
          ? [
              ['M', 0, a],
              ['L', this.plotLeft - 1, a],
              ['L', this.plotLeft - 1, h],
              ['L', 0, h],
              ['Z'],
              ['M', k, a],
              ['L', this.chartWidth, a],
              ['L', this.chartWidth, h],
              ['L', k, h],
              ['Z'],
            ]
          : this.scrollablePixelsY
            ? [
                ['M', g, 0],
                ['L', g, this.plotTop - 1],
                ['L', d, this.plotTop - 1],
                ['L', d, 0],
                ['Z'],
                ['M', g, q],
                ['L', g, this.chartHeight],
                ['L', d, this.chartHeight],
                ['L', d, q],
                ['Z'],
              ]
            : [['M', 0, 0]];
        'adjustHeight' !== this.redrawTrigger &&
          this.scrollableMask.attr({ d: a });
      };
      B(A, 'afterInit', function () {
        this.chart.scrollableDirty = !0;
      });
      B(H, 'show', function () {
        this.chart.scrollableDirty = !0;
      });
      ('');
    },
  );
  M(
    a,
    'Core/Axis/Stacking/StackItem.js',
    [
      a['Core/Templating.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { format: x } = a,
        { series: C } = A,
        { destroyObjectProperties: z, fireEvent: D, isNumber: B, pick: u } = G;
      class q {
        constructor(a, m, q, h, g) {
          const d = a.chart.inverted,
            k = a.reversed;
          this.axis = a;
          a = this.isNegative = !!q !== !!k;
          this.options = m = m || {};
          this.x = h;
          this.cumulative = this.total = null;
          this.points = {};
          this.hasValidPoints = !1;
          this.stack = g;
          this.rightCliff = this.leftCliff = 0;
          this.alignOptions = {
            align: m.align || (d ? (a ? 'left' : 'right') : 'center'),
            verticalAlign:
              m.verticalAlign || (d ? 'middle' : a ? 'bottom' : 'top'),
            y: m.y,
            x: m.x,
          };
          this.textAlign =
            m.textAlign || (d ? (a ? 'right' : 'left') : 'center');
        }
        destroy() {
          z(this, this.axis);
        }
        render(a) {
          const m = this.axis.chart,
            q = this.options;
          var h = q.format;
          h = h ? x(h, this, m) : q.formatter.call(this);
          this.label
            ? this.label.attr({ text: h, visibility: 'hidden' })
            : ((this.label = m.renderer.label(
                h,
                null,
                void 0,
                q.shape,
                void 0,
                void 0,
                q.useHTML,
                !1,
                'stack-labels',
              )),
              (h = {
                r: q.borderRadius || 0,
                text: h,
                padding: u(q.padding, 5),
                visibility: 'hidden',
              }),
              m.styledMode ||
                ((h.fill = q.backgroundColor),
                (h.stroke = q.borderColor),
                (h['stroke-width'] = q.borderWidth),
                this.label.css(q.style || {})),
              this.label.attr(h),
              this.label.added || this.label.add(a));
          this.label.labelrank = m.plotSizeY;
          D(this, 'afterRender');
        }
        setOffset(a, m, q, h, g, d) {
          const {
              alignOptions: k,
              axis: v,
              label: r,
              options: x,
              textAlign: f,
            } = this,
            p = v.chart;
          q = this.getStackBox({
            xOffset: a,
            width: m,
            boxBottom: q,
            boxTop: h,
            defaultX: g,
            xAxis: d,
          });
          var { verticalAlign: t } = k;
          if (r && q) {
            h = r.getBBox();
            g = r.padding;
            d = 'justify' === u(x.overflow, 'justify');
            k.x = x.x || 0;
            k.y = x.y || 0;
            const { x: a, y: m } = this.adjustStackPosition({
              labelBox: h,
              verticalAlign: t,
              textAlign: f,
            });
            q.x -= a;
            q.y -= m;
            r.align(k, !1, q);
            (t = p.isInsidePlot(
              r.alignAttr.x + k.x + a,
              r.alignAttr.y + k.y + m,
            )) || (d = !1);
            d && C.prototype.justifyDataLabel.call(v, r, k, r.alignAttr, h, q);
            r.attr({
              x: r.alignAttr.x,
              y: r.alignAttr.y,
              rotation: x.rotation,
              rotationOriginX: h.width / 2,
              rotationOriginY: h.height / 2,
            });
            u(!d && x.crop, !0) &&
              (t =
                B(r.x) &&
                B(r.y) &&
                p.isInsidePlot(r.x - g + r.width, r.y) &&
                p.isInsidePlot(r.x + g, r.y));
            r[t ? 'show' : 'hide']();
          }
          D(this, 'afterSetOffset', { xOffset: a, width: m });
        }
        adjustStackPosition({ labelBox: a, verticalAlign: m, textAlign: q }) {
          const h = {
            bottom: 0,
            middle: 1,
            top: 2,
            right: 1,
            center: 0,
            left: -1,
          };
          return {
            x: a.width / 2 + (a.width / 2) * h[q],
            y: (a.height / 2) * h[m],
          };
        }
        getStackBox(a) {
          var m = this.axis;
          const q = m.chart,
            { boxTop: h, defaultX: g, xOffset: d, width: k, boxBottom: r } = a;
          var K = m.stacking.usePercentage ? 100 : u(h, this.total, 0);
          K = m.toPixels(K);
          a = a.xAxis || q.xAxis[0];
          const x = u(g, a.translate(this.x)) + d;
          m = m.toPixels(
            r ||
              (B(m.min) && m.logarithmic && m.logarithmic.lin2log(m.min)) ||
              0,
          );
          m = Math.abs(K - m);
          const f = this.isNegative;
          return q.inverted
            ? {
                x: (f ? K : K - m) - q.plotLeft,
                y: a.height - x - k,
                width: m,
                height: k,
              }
            : {
                x: x + a.transB - q.plotLeft,
                y: (f ? K - m : K) - q.plotTop,
                width: k,
                height: m,
              };
        }
      }
      ('');
      return q;
    },
  );
  M(
    a,
    'Core/Axis/Stacking/StackingAxis.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Axis/Axis.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Axis/Stacking/StackItem.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C) {
      function x() {
        const b = this,
          c = b.inverted;
        b.yAxis.forEach((b) => {
          b.stacking &&
            b.stacking.stacks &&
            b.hasVisibleSeries &&
            (b.stacking.oldStacks = b.stacking.stacks);
        });
        b.series.forEach((a) => {
          const e = (a.xAxis && a.xAxis.options) || {};
          !a.options.stacking ||
            (!0 !== a.visible && !1 !== b.options.chart.ignoreHiddenSeries) ||
            (a.stackKey = [
              a.type,
              n(a.options.stack, ''),
              c ? e.top : e.left,
              c ? e.height : e.width,
            ].join());
        });
      }
      function D() {
        const b = this.stacking;
        if (b) {
          var c = b.stacks;
          t(c, function (b, a) {
            K(b);
            c[a] = null;
          });
          b && b.stackTotalGroup && b.stackTotalGroup.destroy();
        }
      }
      function B() {
        'yAxis' !== this.coll || this.stacking || (this.stacking = new w(this));
      }
      function u(b, c, a, e) {
        !y(b) || b.x !== c || (e && b.stackKey !== e)
          ? (b = { x: c, index: 0, key: e, stackKey: e })
          : b.index++;
        b.key = [a, c, b.index].join();
        return b;
      }
      function q() {
        const b = this,
          c = b.stackKey,
          a = b.yAxis.stacking.stacks,
          e = b.processedXData,
          d = b[b.options.stacking + 'Stacker'];
        let f;
        d &&
          [c, '-' + c].forEach((c) => {
            let l = e.length;
            let g;
            for (; l--; ) {
              var n = e[l];
              f = b.getStackIndicator(f, n, b.index, c);
              (g = (n = a[c] && a[c][n]) && n.points[f.key]) &&
                d.call(b, g, n, l);
            }
          });
      }
      function r(b, c, a) {
        c = c.total ? 100 / c.total : 0;
        b[0] = k(b[0] * c);
        b[1] = k(b[1] * c);
        this.stackedYData[a] = b[1];
      }
      function m() {
        const b = this.yAxis.stacking;
        this.options.centerInCategory &&
        (this.is('column') || this.is('columnrange')) &&
        !this.options.stacking &&
        1 < this.chart.series.length
          ? g.setStackedPoints.call(this, 'group')
          : b &&
            t(b.stacks, (c, a) => {
              'group' === a.slice(-5) &&
                (t(c, (b) => b.destroy()), delete b.stacks[a]);
            });
      }
      function v(b) {
        var c = this.chart;
        const a = b || this.options.stacking;
        if (
          a &&
          (!0 === this.visible || !1 === c.options.chart.ignoreHiddenSeries)
        ) {
          var e = this.processedXData,
            d = this.processedYData,
            g = [],
            p = d.length,
            h = this.options,
            t = h.threshold,
            m = n(h.startFromThreshold && t, 0);
          h = h.stack;
          b = b ? `${this.type},${a}` : this.stackKey;
          var w = '-' + b,
            q = this.negStacks;
          c = 'group' === a ? c.yAxis[0] : this.yAxis;
          var v = c.stacking.stacks,
            r = c.stacking.oldStacks,
            u,
            K;
          c.stacking.stacksTouched += 1;
          for (K = 0; K < p; K++) {
            var x = e[K];
            var B = d[K];
            var L = this.getStackIndicator(L, x, this.index);
            var D = L.key;
            var z = (u = q && B < (m ? 0 : t)) ? w : b;
            v[z] || (v[z] = {});
            v[z][x] ||
              (r[z] && r[z][x]
                ? ((v[z][x] = r[z][x]), (v[z][x].total = null))
                : (v[z][x] = new H(c, c.options.stackLabels, !!u, x, h)));
            z = v[z][x];
            null !== B
              ? ((z.points[D] = z.points[this.index] = [n(z.cumulative, m)]),
                y(z.cumulative) || (z.base = D),
                (z.touched = c.stacking.stacksTouched),
                0 < L.index &&
                  !1 === this.singleStacks &&
                  (z.points[D][0] = z.points[this.index + ',' + x + ',0'][0]))
              : (z.points[D] = z.points[this.index] = null);
            'percent' === a
              ? ((u = u ? b : w),
                q && v[u] && v[u][x]
                  ? ((u = v[u][x]),
                    (z.total = u.total =
                      Math.max(u.total, z.total) + Math.abs(B) || 0))
                  : (z.total = k(z.total + (Math.abs(B) || 0))))
              : 'group' === a
                ? (f(B) && (B = B[0]),
                  null !== B && (z.total = (z.total || 0) + 1))
                : (z.total = k(z.total + (B || 0)));
            z.cumulative =
              'group' === a
                ? (z.total || 1) - 1
                : k(n(z.cumulative, m) + (B || 0));
            null !== B &&
              (z.points[D].push(z.cumulative),
              (g[K] = z.cumulative),
              (z.hasValidPoints = !0));
          }
          'percent' === a && (c.stacking.usePercentage = !0);
          'group' !== a && (this.stackedYData = g);
          c.stacking.oldStacks = {};
        }
      }
      const { getDeferredAnimation: h } = a,
        {
          series: { prototype: g },
        } = G,
        {
          addEvent: d,
          correctFloat: k,
          defined: y,
          destroyObjectProperties: K,
          fireEvent: L,
          isArray: f,
          isNumber: p,
          objectEach: t,
          pick: n,
        } = C;
      class w {
        constructor(b) {
          this.oldStacks = {};
          this.stacks = {};
          this.stacksTouched = 0;
          this.axis = b;
        }
        buildStacks() {
          const b = this.axis,
            c = b.series,
            a = b.options.reversedStacks,
            e = c.length;
          let d, f;
          this.usePercentage = !1;
          for (f = e; f--; )
            ((d = c[a ? f : e - f - 1]),
              d.setStackedPoints(),
              d.setGroupedPoints());
          for (f = 0; f < e; f++) c[f].modifyStacks();
          L(b, 'afterBuildStacks');
        }
        cleanStacks() {
          let b;
          this.oldStacks && (b = this.stacks = this.oldStacks);
          t(b, function (b) {
            t(b, function (b) {
              b.cumulative = b.total;
            });
          });
        }
        resetStacks() {
          t(this.stacks, (b) => {
            t(b, (c, a) => {
              p(c.touched) && c.touched < this.stacksTouched
                ? (c.destroy(), delete b[a])
                : ((c.total = null), (c.cumulative = null));
            });
          });
        }
        renderStackTotals() {
          var b = this.axis;
          const c = b.chart,
            a = c.renderer,
            e = this.stacks;
          b = h(
            c,
            (b.options.stackLabels && b.options.stackLabels.animation) || !1,
          );
          const d = (this.stackTotalGroup =
            this.stackTotalGroup ||
            a.g('stack-labels').attr({ zIndex: 6, opacity: 0 }).add());
          d.translate(c.plotLeft, c.plotTop);
          t(e, function (b) {
            t(b, function (b) {
              b.render(d);
            });
          });
          d.animate({ opacity: 1 }, b);
        }
      }
      var e;
      (function (b) {
        const c = [];
        b.compose = function (b, a, e) {
          C.pushUnique(c, b) && (d(b, 'init', B), d(b, 'destroy', D));
          C.pushUnique(c, a) && (a.prototype.getStacks = x);
          C.pushUnique(c, e) &&
            ((b = e.prototype),
            (b.getStackIndicator = u),
            (b.modifyStacks = q),
            (b.percentStacker = r),
            (b.setGroupedPoints = m),
            (b.setStackedPoints = v));
        };
      })(e || (e = {}));
      return e;
    },
  );
  M(
    a,
    'Series/Line/LineSeries.js',
    [
      a['Core/Series/Series.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { defined: x, merge: C } = G;
      class z extends a {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
        drawGraph() {
          const a = this,
            x = this.options,
            u = (this.gappedPath || this.getGraphPath).call(this),
            q = this.chart.styledMode;
          let r = [['graph', 'highcharts-graph']];
          q || r[0].push(x.lineColor || this.color || '#cccccc', x.dashStyle);
          r = a.getZonesGraphs(r);
          r.forEach(function (m, v) {
            var h = m[0];
            let g = a[h];
            const d = g ? 'animate' : 'attr';
            g
              ? ((g.endX = a.preventGraphAnimation ? null : u.xMap),
                g.animate({ d: u }))
              : u.length &&
                (a[h] = g =
                  a.chart.renderer
                    .path(u)
                    .addClass(m[1])
                    .attr({ zIndex: 1 })
                    .add(a.group));
            g &&
              !q &&
              ((h = {
                stroke: m[2],
                'stroke-width': x.lineWidth || 0,
                fill: (a.fillGraph && a.color) || 'none',
              }),
              m[3]
                ? (h.dashstyle = m[3])
                : 'square' !== x.linecap &&
                  (h['stroke-linecap'] = h['stroke-linejoin'] = 'round'),
              g[d](h).shadow(2 > v && x.shadow));
            g && ((g.startX = u.xMap), (g.isArea = u.isArea));
          });
        }
        getGraphPath(a, B, u) {
          const q = this,
            r = q.options,
            m = [],
            v = [];
          let h,
            g = r.step;
          a = a || q.points;
          const d = a.reversed;
          d && a.reverse();
          (g = { right: 1, center: 2 }[g] || (g && 3)) && d && (g = 4 - g);
          a = this.getValidPoints(a, !1, !(r.connectNulls && !B && !u));
          a.forEach(function (d, y) {
            const k = d.plotX,
              L = d.plotY,
              f = a[y - 1],
              p = d.isNull || 'number' !== typeof L;
            (d.leftCliff || (f && f.rightCliff)) && !u && (h = !0);
            p && !x(B) && 0 < y
              ? (h = !r.connectNulls)
              : p && !B
                ? (h = !0)
                : (0 === y || h
                    ? (y = [['M', d.plotX, d.plotY]])
                    : q.getPointSpline
                      ? (y = [q.getPointSpline(a, d, y)])
                      : g
                        ? ((y =
                            1 === g
                              ? [['L', f.plotX, L]]
                              : 2 === g
                                ? [
                                    ['L', (f.plotX + k) / 2, f.plotY],
                                    ['L', (f.plotX + k) / 2, L],
                                  ]
                                : [['L', k, f.plotY]]),
                          y.push(['L', k, L]))
                        : (y = [['L', k, L]]),
                  v.push(d.x),
                  g && (v.push(d.x), 2 === g && v.push(d.x)),
                  m.push.apply(m, y),
                  (h = !1));
          });
          m.xMap = v;
          return (q.graphPath = m);
        }
        getZonesGraphs(a) {
          this.zones.forEach(function (x, u) {
            u = [
              'zone-graph-' + u,
              'highcharts-graph highcharts-zone-graph-' +
                u +
                ' ' +
                (x.className || ''),
            ];
            this.chart.styledMode ||
              u.push(
                x.color || this.color,
                x.dashStyle || this.options.dashStyle,
              );
            a.push(u);
          }, this);
          return a;
        }
      }
      z.defaultOptions = C(a.defaultOptions, { legendSymbol: 'lineMarker' });
      A.registerSeriesType('line', z);
      ('');
      return z;
    },
  );
  M(
    a,
    'Series/Area/AreaSeries.js',
    [
      a['Core/Color/Color.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const {
          seriesTypes: { line: x },
        } = A,
        { extend: C, merge: z, objectEach: D, pick: B } = G;
      class u extends x {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
        drawGraph() {
          this.areaPath = [];
          super.drawGraph.apply(this);
          const a = this,
            r = this.areaPath,
            m = this.options,
            v = [['area', 'highcharts-area', this.color, m.fillColor]];
          this.zones.forEach(function (h, g) {
            v.push([
              'zone-area-' + g,
              'highcharts-area highcharts-zone-area-' + g + ' ' + h.className,
              h.color || a.color,
              h.fillColor || m.fillColor,
            ]);
          });
          v.forEach(function (h) {
            const g = h[0],
              d = {};
            let k = a[g];
            const q = k ? 'animate' : 'attr';
            k
              ? ((k.endX = a.preventGraphAnimation ? null : r.xMap),
                k.animate({ d: r }))
              : ((d.zIndex = 0),
                (k = a[g] =
                  a.chart.renderer.path(r).addClass(h[1]).add(a.group)),
                (k.isArea = !0));
            a.chart.styledMode ||
              (h[3]
                ? (d.fill = h[3])
                : ((d.fill = h[2]),
                  (d['fill-opacity'] = B(m.fillOpacity, 0.75))));
            k[q](d);
            k.startX = r.xMap;
            k.shiftUnit = m.step ? 2 : 1;
          });
        }
        getGraphPath(a) {
          var q = x.prototype.getGraphPath,
            m = this.options;
          const v = m.stacking,
            h = this.yAxis,
            g = [],
            d = [],
            k = this.index,
            y = h.stacking.stacks[this.stackKey],
            u = m.threshold,
            L = Math.round(h.getThreshold(m.threshold));
          m = B(m.connectNulls, 'percent' === v);
          var f = function (f, e, b) {
            var c = a[f];
            f = v && y[c.x].points[k];
            const l = c[b + 'Null'] || 0;
            b = c[b + 'Cliff'] || 0;
            let n, t;
            c = !0;
            b || l
              ? ((n = (l ? f[0] : f[1]) + b), (t = f[0] + b), (c = !!l))
              : !v && a[e] && a[e].isNull && (n = t = u);
            'undefined' !== typeof n &&
              (d.push({
                plotX: p,
                plotY: null === n ? L : h.getThreshold(n),
                isNull: c,
                isCliff: !0,
              }),
              g.push({
                plotX: p,
                plotY: null === t ? L : h.getThreshold(t),
                doCurve: !1,
              }));
          };
          let p;
          a = a || this.points;
          v && (a = this.getStackPoints(a));
          for (let k = 0, e = a.length; k < e; ++k) {
            v ||
              (a[k].leftCliff =
                a[k].rightCliff =
                a[k].leftNull =
                a[k].rightNull =
                  void 0);
            var t = a[k].isNull;
            p = B(a[k].rectPlotX, a[k].plotX);
            var n = v ? B(a[k].yBottom, L) : L;
            if (!t || m)
              (m || f(k, k - 1, 'left'),
                (t && !v && m) ||
                  (d.push(a[k]), g.push({ x: k, plotX: p, plotY: n })),
                m || f(k, k + 1, 'right'));
          }
          f = q.call(this, d, !0, !0);
          g.reversed = !0;
          t = q.call(this, g, !0, !0);
          (n = t[0]) && 'M' === n[0] && (t[0] = ['L', n[1], n[2]]);
          t = f.concat(t);
          t.length && t.push(['Z']);
          q = q.call(this, d, !1, m);
          t.xMap = f.xMap;
          this.areaPath = t;
          return q;
        }
        getStackPoints(a) {
          const q = this,
            m = [],
            v = [],
            h = this.xAxis,
            g = this.yAxis,
            d = g.stacking.stacks[this.stackKey],
            k = {},
            y = g.series,
            u = y.length,
            x = g.options.reversedStacks ? 1 : -1,
            f = y.indexOf(q);
          a = a || this.points;
          if (this.options.stacking) {
            for (let d = 0; d < a.length; d++)
              ((a[d].leftNull = a[d].rightNull = void 0), (k[a[d].x] = a[d]));
            D(d, function (a, d) {
              null !== a.total && v.push(d);
            });
            v.sort(function (a, d) {
              return a - d;
            });
            const p = y.map((a) => a.visible);
            v.forEach(function (a, n) {
              let t = 0,
                e,
                b;
              if (k[a] && !k[a].isNull)
                (m.push(k[a]),
                  [-1, 1].forEach(function (c) {
                    const l = 1 === c ? 'rightNull' : 'leftNull',
                      g = d[v[n + c]];
                    let h = 0;
                    if (g) {
                      let c = f;
                      for (; 0 <= c && c < u; ) {
                        const f = y[c].index;
                        e = g.points[f];
                        e ||
                          (f === q.index
                            ? (k[a][l] = !0)
                            : p[c] &&
                              (b = d[a].points[f]) &&
                              (h -= b[1] - b[0]));
                        c += x;
                      }
                    }
                    k[a][1 === c ? 'rightCliff' : 'leftCliff'] = h;
                  }));
              else {
                let b = f;
                for (; 0 <= b && b < u; ) {
                  if ((e = d[a].points[y[b].index])) {
                    t = e[1];
                    break;
                  }
                  b += x;
                }
                t = B(t, 0);
                t = g.translate(t, 0, 1, 0, 1);
                m.push({
                  isNull: !0,
                  plotX: h.translate(a, 0, 0, 0, 1),
                  x: a,
                  plotY: t,
                  yBottom: t,
                });
              }
            });
          }
          return m;
        }
      }
      u.defaultOptions = z(x.defaultOptions, {
        threshold: 0,
        legendSymbol: 'rectangle',
      });
      C(u.prototype, { singleStacks: !1 });
      A.registerSeriesType('area', u);
      ('');
      return u;
    },
  );
  M(
    a,
    'Series/Spline/SplineSeries.js',
    [a['Core/Series/SeriesRegistry.js'], a['Core/Utilities.js']],
    function (a, A) {
      const { line: x } = a.seriesTypes,
        { merge: H, pick: C } = A;
      class z extends x {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
        getPointSpline(a, x, u) {
          const q = x.plotX || 0,
            r = x.plotY || 0,
            m = a[u - 1];
          u = a[u + 1];
          let v, h;
          let g;
          if (
            m &&
            !m.isNull &&
            !1 !== m.doCurve &&
            !x.isCliff &&
            u &&
            !u.isNull &&
            !1 !== u.doCurve &&
            !x.isCliff
          ) {
            a = m.plotY || 0;
            var d = u.plotX || 0;
            u = u.plotY || 0;
            let k = 0;
            v = (1.5 * q + (m.plotX || 0)) / 2.5;
            h = (1.5 * r + a) / 2.5;
            d = (1.5 * q + d) / 2.5;
            g = (1.5 * r + u) / 2.5;
            d !== v && (k = ((g - h) * (d - q)) / (d - v) + r - g);
            h += k;
            g += k;
            h > a && h > r
              ? ((h = Math.max(a, r)), (g = 2 * r - h))
              : h < a && h < r && ((h = Math.min(a, r)), (g = 2 * r - h));
            g > u && g > r
              ? ((g = Math.max(u, r)), (h = 2 * r - g))
              : g < u && g < r && ((g = Math.min(u, r)), (h = 2 * r - g));
            x.rightContX = d;
            x.rightContY = g;
          }
          x = [
            'C',
            C(m.rightContX, m.plotX, 0),
            C(m.rightContY, m.plotY, 0),
            C(v, q, 0),
            C(h, r, 0),
            q,
            r,
          ];
          m.rightContX = m.rightContY = void 0;
          return x;
        }
      }
      z.defaultOptions = H(x.defaultOptions);
      a.registerSeriesType('spline', z);
      ('');
      return z;
    },
  );
  M(
    a,
    'Series/AreaSpline/AreaSplineSeries.js',
    [
      a['Series/Spline/SplineSeries.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const {
          area: x,
          area: { prototype: C },
        } = A.seriesTypes,
        { extend: z, merge: D } = G;
      class B extends a {
        constructor() {
          super(...arguments);
          this.options = this.points = this.data = void 0;
        }
      }
      B.defaultOptions = D(a.defaultOptions, x.defaultOptions);
      z(B.prototype, {
        getGraphPath: C.getGraphPath,
        getStackPoints: C.getStackPoints,
        drawGraph: C.drawGraph,
      });
      A.registerSeriesType('areaspline', B);
      ('');
      return B;
    },
  );
  M(a, 'Series/Column/ColumnSeriesDefaults.js', [], function () {
    '';
    return {
      borderRadius: 3,
      centerInCategory: !1,
      groupPadding: 0.2,
      marker: null,
      pointPadding: 0.1,
      minPointLength: 0,
      cropThreshold: 50,
      pointRange: null,
      states: {
        hover: { halo: !1, brightness: 0.1 },
        select: { color: '#cccccc', borderColor: '#000000' },
      },
      dataLabels: { align: void 0, verticalAlign: void 0, y: void 0 },
      startFromThreshold: !0,
      stickyTracking: !1,
      tooltip: { distance: 6 },
      threshold: 0,
      borderColor: '#ffffff',
    };
  });
  M(
    a,
    'Series/Column/ColumnSeries.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Color/Color.js'],
      a['Series/Column/ColumnSeriesDefaults.js'],
      a['Core/Globals.js'],
      a['Core/Series/Series.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D) {
      const { animObject: x } = a,
        { parse: u } = A,
        { hasTouch: q, noop: r } = H,
        {
          clamp: m,
          defined: v,
          extend: h,
          fireEvent: g,
          isArray: d,
          isNumber: k,
          merge: y,
          pick: K,
          objectEach: L,
        } = D;
      class f extends C {
        constructor() {
          super(...arguments);
          this.points =
            this.options =
            this.group =
            this.data =
            this.borderWidth =
              void 0;
        }
        animate(a) {
          const d = this,
            f = this.yAxis,
            g = f.pos,
            e = d.options,
            b = this.chart.inverted,
            c = {},
            l = b ? 'translateX' : 'translateY';
          let p;
          a
            ? ((c.scaleY = 0.001),
              (a = m(f.toPixels(e.threshold), g, g + f.len)),
              b ? (c.translateX = a - f.len) : (c.translateY = a),
              d.clipBox && d.setClip(),
              d.group.attr(c))
            : ((p = Number(d.group.attr(l))),
              d.group.animate(
                { scaleY: 1 },
                h(x(d.options.animation), {
                  step: function (b, a) {
                    d.group && ((c[l] = p + a.pos * (g - p)), d.group.attr(c));
                  },
                }),
              ));
        }
        init(a, d) {
          super.init.apply(this, arguments);
          const f = this;
          a = f.chart;
          a.hasRendered &&
            a.series.forEach(function (a) {
              a.type === f.type && (a.isDirty = !0);
            });
        }
        getColumnMetrics() {
          const a = this;
          var d = a.options;
          const f = a.xAxis,
            g = a.yAxis;
          var e = f.options.reversedStacks;
          e = (f.reversed && !e) || (!f.reversed && e);
          const b = {};
          let c,
            l = 0;
          !1 === d.grouping
            ? (l = 1)
            : a.chart.series.forEach(function (e) {
                const d = e.yAxis,
                  f = e.options;
                let n;
                e.type !== a.type ||
                  (!e.visible && a.chart.options.chart.ignoreHiddenSeries) ||
                  g.len !== d.len ||
                  g.pos !== d.pos ||
                  (f.stacking && 'group' !== f.stacking
                    ? ((c = e.stackKey),
                      'undefined' === typeof b[c] && (b[c] = l++),
                      (n = b[c]))
                    : !1 !== f.grouping && (n = l++),
                  (e.columnIndex = n));
              });
          const k = Math.min(
              Math.abs(f.transA) *
                ((f.ordinal && f.ordinal.slope) ||
                  d.pointRange ||
                  f.closestPointRange ||
                  f.tickInterval ||
                  1),
              f.len,
            ),
            h = k * d.groupPadding,
            m = (k - 2 * h) / (l || 1);
          d = Math.min(
            d.maxPointWidth || f.len,
            K(d.pointWidth, m * (1 - 2 * d.pointPadding)),
          );
          a.columnMetrics = {
            width: d,
            offset:
              (m - d) / 2 +
              (h + ((a.columnIndex || 0) + (e ? 1 : 0)) * m - k / 2) *
                (e ? -1 : 1),
            paddedWidth: m,
            columnCount: l,
          };
          return a.columnMetrics;
        }
        crispCol(a, d, f, g) {
          var e = this.borderWidth,
            b = -(e % 2 ? 0.5 : 0);
          e = e % 2 ? 0.5 : 1;
          this.options.crisp &&
            ((f = Math.round(a + f) + b), (a = Math.round(a) + b), (f -= a));
          g = Math.round(d + g) + e;
          b = 0.5 >= Math.abs(d) && 0.5 < g;
          d = Math.round(d) + e;
          g -= d;
          b && g && (--d, (g += 1));
          return { x: a, y: d, width: f, height: g };
        }
        adjustForMissingColumns(a, f, g, k) {
          const e = this.options.stacking;
          if (!g.isNull && 1 < k.columnCount) {
            const b = this.yAxis.options.reversedStacks;
            let c = 0,
              l = b ? 0 : -k.columnCount;
            L(this.yAxis.stacking && this.yAxis.stacking.stacks, (a) => {
              if ('number' === typeof g.x) {
                const f = a[g.x.toString()];
                f &&
                  ((a = f.points[this.index]),
                  e
                    ? (a && (c = l), f.hasValidPoints && (b ? l++ : l--))
                    : d(a) &&
                      ((a = Object.keys(f.points)
                        .filter(
                          (b) =>
                            !b.match(',') &&
                            f.points[b] &&
                            1 < f.points[b].length,
                        )
                        .map(parseFloat)
                        .sort((b, a) => a - b)),
                      (c = a.indexOf(this.index)),
                      (l = a.length)));
              }
            });
            a =
              (g.plotX || 0) +
              ((l - 1) * k.paddedWidth + f) / 2 -
              f -
              c * k.paddedWidth;
          }
          return a;
        }
        translate() {
          const a = this,
            d = a.chart,
            f = a.options;
          var h = (a.dense = 2 > a.closestPointRange * a.xAxis.transA);
          h = a.borderWidth = K(f.borderWidth, h ? 0 : 1);
          const e = a.xAxis,
            b = a.yAxis,
            c = f.threshold,
            l = K(f.minPointLength, 5),
            q = a.getColumnMetrics(),
            r = q.width,
            y = (a.pointXOffset = q.offset),
            u = a.dataMin,
            x = a.dataMax;
          let O = (a.barW = Math.max(r, 1 + 2 * h)),
            L = (a.translatedThreshold = b.getThreshold(c));
          d.inverted && (L -= 0.5);
          f.pointPadding && (O = Math.ceil(O));
          C.prototype.translate.apply(a);
          a.points.forEach(function (g) {
            const n = K(g.yBottom, L);
            var p = 999 + Math.abs(n),
              h = g.plotX || 0;
            p = m(g.plotY, -p, b.len + p);
            let t = Math.min(p, n),
              w = Math.max(p, n) - t,
              I = r,
              F = h + y,
              J = O;
            l &&
              Math.abs(w) < l &&
              ((w = l),
              (h = (!b.reversed && !g.negative) || (b.reversed && g.negative)),
              k(c) &&
                k(x) &&
                g.y === c &&
                x <= c &&
                (b.min || 0) < c &&
                (u !== x || (b.max || 0) <= c) &&
                ((h = !h), (g.negative = !g.negative)),
              (t = Math.abs(t - L) > l ? n - l : L - (h ? l : 0)));
            v(g.options.pointWidth) &&
              ((I = J = Math.ceil(g.options.pointWidth)),
              (F -= Math.round((I - r) / 2)));
            f.centerInCategory && (F = a.adjustForMissingColumns(F, I, g, q));
            g.barX = F;
            g.pointWidth = I;
            g.tooltipPos = d.inverted
              ? [
                  m(
                    b.len + b.pos - d.plotLeft - p,
                    b.pos - d.plotLeft,
                    b.len + b.pos - d.plotLeft,
                  ),
                  e.len + e.pos - d.plotTop - F - J / 2,
                  w,
                ]
              : [
                  e.left - d.plotLeft + F + J / 2,
                  m(
                    p + b.pos - d.plotTop,
                    b.pos - d.plotTop,
                    b.len + b.pos - d.plotTop,
                  ),
                  w,
                ];
            g.shapeType = a.pointClass.prototype.shapeType || 'roundedRect';
            g.shapeArgs = a.crispCol(F, g.isNull ? L : t, J, g.isNull ? 0 : w);
          });
          g(this, 'afterColumnTranslate');
        }
        drawGraph() {
          this.group[this.dense ? 'addClass' : 'removeClass'](
            'highcharts-dense-data',
          );
        }
        pointAttribs(a, d) {
          const f = this.options;
          var g = this.pointAttrToOptions || {},
            e = g.stroke || 'borderColor';
          const b = g['stroke-width'] || 'borderWidth';
          let c,
            l = (a && a.color) || this.color,
            k = (a && a[e]) || f[e] || l;
          g = (a && a.options.dashStyle) || f.dashStyle;
          let p = (a && a[b]) || f[b] || this[b] || 0,
            h = K(a && a.opacity, f.opacity, 1);
          a &&
            this.zones.length &&
            ((c = a.getZone()),
            (l =
              a.options.color ||
              (c && (c.color || a.nonZonedColor)) ||
              this.color),
            c &&
              ((k = c.borderColor || k),
              (g = c.dashStyle || g),
              (p = c.borderWidth || p)));
          d &&
            a &&
            ((a = y(
              f.states[d],
              (a.options.states && a.options.states[d]) || {},
            )),
            (d = a.brightness),
            (l =
              a.color ||
              ('undefined' !== typeof d && u(l).brighten(a.brightness).get()) ||
              l),
            (k = a[e] || k),
            (p = a[b] || p),
            (g = a.dashStyle || g),
            (h = K(a.opacity, h)));
          e = { fill: l, stroke: k, 'stroke-width': p, opacity: h };
          g && (e.dashstyle = g);
          return e;
        }
        drawPoints(a = this.points) {
          const d = this,
            f = this.chart,
            g = d.options,
            e = f.renderer,
            b = g.animationLimit || 250;
          let c;
          a.forEach(function (a) {
            let l = a.graphic,
              n = !!l,
              p = l && f.pointCount < b ? 'animate' : 'attr';
            if (k(a.plotY) && null !== a.y) {
              c = a.shapeArgs;
              l && a.hasNewShapeType() && (l = l.destroy());
              d.enabledDataSorting &&
                (a.startXPos = d.xAxis.reversed
                  ? -(c ? c.width || 0 : 0)
                  : d.xAxis.width);
              l ||
                ((a.graphic = l = e[a.shapeType](c).add(a.group || d.group)) &&
                  d.enabledDataSorting &&
                  f.hasRendered &&
                  f.pointCount < b &&
                  (l.attr({ x: a.startXPos }), (n = !0), (p = 'animate')));
              if (l && n) l[p](y(c));
              f.styledMode ||
                l[p](d.pointAttribs(a, a.selected && 'select')).shadow(
                  !1 !== a.allowShadow && g.shadow,
                );
              l &&
                (l.addClass(a.getClassName(), !0),
                l.attr({ visibility: a.visible ? 'inherit' : 'hidden' }));
            } else l && (a.graphic = l.destroy());
          });
        }
        drawTracker(a = this.points) {
          const f = this,
            n = f.chart,
            k = n.pointer,
            e = function (b) {
              const a = k.getPointFromEvent(b);
              'undefined' !== typeof a &&
                f.options.enableMouseTracking &&
                ((k.isDirectTouch = !0), a.onMouseOver(b));
            };
          let b;
          a.forEach(function (a) {
            b = d(a.dataLabels)
              ? a.dataLabels
              : a.dataLabel
                ? [a.dataLabel]
                : [];
            a.graphic && (a.graphic.element.point = a);
            b.forEach(function (b) {
              b.div ? (b.div.point = a) : (b.element.point = a);
            });
          });
          f._hasTracking ||
            (f.trackerGroups.forEach(function (b) {
              if (f[b]) {
                f[b]
                  .addClass('highcharts-tracker')
                  .on('mouseover', e)
                  .on('mouseout', function (b) {
                    k.onTrackerMouseOut(b);
                  });
                if (q) f[b].on('touchstart', e);
                !n.styledMode &&
                  f.options.cursor &&
                  f[b].css({ cursor: f.options.cursor });
              }
            }),
            (f._hasTracking = !0));
          g(this, 'afterDrawTracker');
        }
        remove() {
          const a = this,
            d = a.chart;
          d.hasRendered &&
            d.series.forEach(function (d) {
              d.type === a.type && (d.isDirty = !0);
            });
          C.prototype.remove.apply(a, arguments);
        }
      }
      f.defaultOptions = y(C.defaultOptions, G);
      h(f.prototype, {
        cropShoulder: 0,
        directTouch: !0,
        getSymbol: r,
        negStacks: !0,
        trackerGroups: ['group', 'dataLabelsGroup'],
      });
      z.registerSeriesType('column', f);
      ('');
      return f;
    },
  );
  M(
    a,
    'Core/Series/DataLabel.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Templating.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { getDeferredAnimation: x } = a,
        { format: C } = A,
        {
          defined: z,
          extend: D,
          fireEvent: B,
          isArray: u,
          isString: q,
          merge: r,
          objectEach: m,
          pick: v,
          splat: h,
        } = G;
      var g;
      (function (a) {
        function d(a, b, c, d, f) {
          const e = this.chart;
          var l = this.isCartesian && e.inverted;
          const g = this.enabledDataSorting;
          var n = a.plotX,
            k = a.plotY;
          const p = c.rotation;
          var h = c.align;
          k =
            z(n) &&
            z(k) &&
            e.isInsidePlot(n, Math.round(k), {
              inverted: l,
              paneCoordinates: !0,
              series: this,
            });
          let m = 'justify' === v(c.overflow, g ? 'none' : 'justify');
          l =
            this.visible &&
            !1 !== a.visible &&
            z(n) &&
            (a.series.forceDL ||
              (g && !m) ||
              k ||
              (v(c.inside, !!this.options.stacking) &&
                d &&
                e.isInsidePlot(n, l ? d.x + 1 : d.y + d.height - 1, {
                  inverted: l,
                  paneCoordinates: !0,
                  series: this,
                })));
          n = a.pos();
          if (l && n) {
            p && b.attr({ align: h });
            h = b.getBBox(!0);
            var t = [0, 0];
            var w = e.renderer.fontMetrics(b).b;
            d = D({ x: n[0], y: Math.round(n[1]), width: 0, height: 0 }, d);
            D(c, { width: h.width, height: h.height });
            p
              ? ((m = !1),
                (t = e.renderer.rotCorr(w, p)),
                (w = {
                  x: d.x + (c.x || 0) + d.width / 2 + t.x,
                  y:
                    d.y +
                    (c.y || 0) +
                    { top: 0, middle: 0.5, bottom: 1 }[c.verticalAlign] *
                      d.height,
                }),
                (t = [h.x - Number(b.attr('x')), h.y - Number(b.attr('y'))]),
                g &&
                  this.xAxis &&
                  !m &&
                  this.setDataLabelStartPos(a, b, f, k, w),
                b[f ? 'attr' : 'animate'](w))
              : (g &&
                  this.xAxis &&
                  !m &&
                  this.setDataLabelStartPos(a, b, f, k, d),
                b.align(c, void 0, d),
                (w = b.alignAttr));
            if (m && 0 <= d.height) this.justifyDataLabel(b, c, w, h, d, f);
            else if (v(c.crop, !0)) {
              let { x: b, y: a } = w;
              b += t[0];
              a += t[1];
              l =
                e.isInsidePlot(b, a, { paneCoordinates: !0, series: this }) &&
                e.isInsidePlot(b + h.width, a + h.height, {
                  paneCoordinates: !0,
                  series: this,
                });
            }
            if (c.shape && !p)
              b[f ? 'attr' : 'animate']({ anchorX: n[0], anchorY: n[1] });
          }
          f && g && (b.placed = !1);
          l || (g && !m) ? b.show() : (b.hide(), (b.placed = !1));
        }
        function g(a, b) {
          var c = b.filter;
          return c
            ? ((b = c.operator),
              (a = a[c.property]),
              (c = c.value),
              ('>' === b && a > c) ||
              ('<' === b && a < c) ||
              ('>=' === b && a >= c) ||
              ('<=' === b && a <= c) ||
              ('==' === b && a == c) ||
              ('===' === b && a === c)
                ? !0
                : !1)
            : !0;
        }
        function K() {
          return this.plotGroup(
            'dataLabelsGroup',
            'data-labels',
            this.hasRendered ? 'inherit' : 'hidden',
            this.options.dataLabels.zIndex || 6,
          );
        }
        function L(a) {
          const b = this.hasRendered || 0,
            c = this.initDataLabelsGroup().attr({ opacity: +b });
          !b &&
            c &&
            (this.visible && c.show(),
            this.options.animation
              ? c.animate({ opacity: 1 }, a)
              : c.attr({ opacity: 1 }));
          return c;
        }
        function f(a = this.points) {
          var b, c;
          const e = this,
            d = e.chart,
            f = e.options,
            n = d.renderer,
            { backgroundColor: k, plotBackgroundColor: p } = d.options.chart,
            w = d.options.plotOptions,
            r = n.getContrast((q(p) && p) || (q(k) && k) || '#000000');
          let y = f.dataLabels,
            E,
            K;
          var L = h(y)[0];
          const D = L.animation;
          L = L.defer ? x(d, D, e) : { defer: 0, duration: 0 };
          y = t(
            t(
              null === (b = null === w || void 0 === w ? void 0 : w.series) ||
                void 0 === b
                ? void 0
                : b.dataLabels,
              null === (c = null === w || void 0 === w ? void 0 : w[e.type]) ||
                void 0 === c
                ? void 0
                : c.dataLabels,
            ),
            y,
          );
          B(this, 'drawDataLabels');
          if (u(y) || y.enabled || e._hasPointLabels)
            ((K = this.initDataLabels(L)),
              a.forEach((b) => {
                var a;
                const c = b.dataLabels || [];
                E = h(
                  t(
                    y,
                    b.dlOptions ||
                      (null === (a = b.options) || void 0 === a
                        ? void 0
                        : a.dataLabels),
                  ),
                );
                E.forEach((a, l) => {
                  var k,
                    p =
                      a.enabled && (!b.isNull || b.dataLabelOnNull) && g(b, a);
                  const h = b.connectors ? b.connectors[l] : b.connector,
                    t = a.style || {};
                  let w = {},
                    y = c[l],
                    F = !y;
                  const I = v(a.distance, b.labelDistance);
                  if (p) {
                    var u = v(a[b.formatPrefix + 'Format'], a.format);
                    var J = b.getLabelConfig();
                    J = z(u)
                      ? C(u, J, d)
                      : (a[b.formatPrefix + 'Formatter'] || a.formatter).call(
                          J,
                          a,
                        );
                    u = a.rotation;
                    d.styledMode ||
                      ((t.color = v(
                        a.color,
                        t.color,
                        q(e.color) ? e.color : void 0,
                        '#000000',
                      )),
                      'contrast' === t.color
                        ? ((b.contrastColor = n.getContrast(
                            b.color || e.color,
                          )),
                          (t.color =
                            (!z(I) && a.inside) || 0 > (I || 0) || f.stacking
                              ? b.contrastColor
                              : r))
                        : delete b.contrastColor,
                      f.cursor && (t.cursor = f.cursor));
                    w = {
                      r: a.borderRadius || 0,
                      rotation: u,
                      padding: a.padding,
                      zIndex: 1,
                    };
                    if (!d.styledMode) {
                      const { backgroundColor: c, borderColor: e } = a;
                      w.fill = 'auto' === c ? b.color : c;
                      w.stroke = 'auto' === e ? b.color : e;
                      w['stroke-width'] = a.borderWidth;
                    }
                    m(w, (b, a) => {
                      'undefined' === typeof b && delete w[a];
                    });
                  }
                  !y ||
                    (p &&
                      z(J) &&
                      !!y.div === !!a.useHTML &&
                      ((y.rotation && a.rotation) ||
                        y.rotation === a.rotation)) ||
                    ((y = void 0),
                    (F = !0),
                    h &&
                      b.connector &&
                      ((b.connector = b.connector.destroy()),
                      b.connectors &&
                        (1 === b.connectors.length
                          ? delete b.connectors
                          : delete b.connectors[l])));
                  p &&
                    z(J) &&
                    (y
                      ? (w.text = J)
                      : (y = u
                          ? n
                              .text(J, 0, 0, a.useHTML)
                              .addClass('highcharts-data-label')
                          : n.label(
                              J,
                              0,
                              0,
                              a.shape,
                              void 0,
                              void 0,
                              a.useHTML,
                              void 0,
                              'data-label',
                            )) &&
                        y.addClass(
                          ' highcharts-data-label-color-' +
                            b.colorIndex +
                            ' ' +
                            (a.className || '') +
                            (a.useHTML ? ' highcharts-tracker' : ''),
                        ),
                    y &&
                      ((y.options = a),
                      y.attr(w),
                      d.styledMode || y.css(t).shadow(a.shadow),
                      (p = a[b.formatPrefix + 'TextPath'] || a.textPath) &&
                        !a.useHTML &&
                        (y.setTextPath(
                          (null === (k = b.getDataLabelPath) || void 0 === k
                            ? void 0
                            : k.call(b, y)) || b.graphic,
                          p,
                        ),
                        b.dataLabelPath &&
                          !p.enabled &&
                          (b.dataLabelPath = b.dataLabelPath.destroy())),
                      y.added || y.add(K),
                      e.alignDataLabel(b, y, a, void 0, F),
                      (y.isActive = !0),
                      c[l] && c[l] !== y && c[l].destroy(),
                      (c[l] = y)));
                });
                for (a = c.length; a--; )
                  c[a].isActive
                    ? (c[a].isActive = !1)
                    : (c[a].destroy(), c.splice(a, 1));
                b.dataLabel = c[0];
                b.dataLabels = c;
              }));
          B(this, 'afterDrawDataLabels');
        }
        function p(a, b, c, d, f, g) {
          const e = this.chart,
            l = b.align,
            n = b.verticalAlign,
            k = a.box ? 0 : a.padding || 0;
          let { x: p = 0, y: h = 0 } = b,
            m,
            t;
          m = (c.x || 0) + k;
          0 > m &&
            ('right' === l && 0 <= p
              ? ((b.align = 'left'), (b.inside = !0))
              : (p -= m),
            (t = !0));
          m = (c.x || 0) + d.width - k;
          m > e.plotWidth &&
            ('left' === l && 0 >= p
              ? ((b.align = 'right'), (b.inside = !0))
              : (p += e.plotWidth - m),
            (t = !0));
          m = c.y + k;
          0 > m &&
            ('bottom' === n && 0 <= h
              ? ((b.verticalAlign = 'top'), (b.inside = !0))
              : (h -= m),
            (t = !0));
          m = (c.y || 0) + d.height - k;
          m > e.plotHeight &&
            ('top' === n && 0 >= h
              ? ((b.verticalAlign = 'bottom'), (b.inside = !0))
              : (h += e.plotHeight - m),
            (t = !0));
          t && ((b.x = p), (b.y = h), (a.placed = !g), a.align(b, void 0, f));
          return t;
        }
        function t(a, b) {
          let c = [],
            e;
          if (u(a) && !u(b))
            c = a.map(function (a) {
              return r(a, b);
            });
          else if (u(b) && !u(a))
            c = b.map(function (b) {
              return r(a, b);
            });
          else if (!u(a) && !u(b)) c = r(a, b);
          else if (u(a) && u(b))
            for (e = Math.max(a.length, b.length); e--; ) c[e] = r(a[e], b[e]);
          return c;
        }
        function n(a, b, c, d, f) {
          const e = this.chart,
            l = e.inverted,
            g = this.xAxis,
            n = g.reversed,
            k = l ? b.height / 2 : b.width / 2;
          a = (a = a.pointWidth) ? a / 2 : 0;
          b.startXPos = l ? f.x : n ? -k - a : g.width - k + a;
          b.startYPos = l ? (n ? this.yAxis.height - k + a : -k - a) : f.y;
          d
            ? 'hidden' === b.visibility &&
              (b.show(), b.attr({ opacity: 0 }).animate({ opacity: 1 }))
            : b.attr({ opacity: 1 }).animate({ opacity: 0 }, void 0, b.hide);
          e.hasRendered &&
            (c && b.attr({ x: b.startXPos, y: b.startYPos }), (b.placed = !0));
        }
        const w = [];
        a.compose = function (a) {
          G.pushUnique(w, a) &&
            ((a = a.prototype),
            (a.initDataLabelsGroup = K),
            (a.initDataLabels = L),
            (a.alignDataLabel = d),
            (a.drawDataLabels = f),
            (a.justifyDataLabel = p),
            (a.setDataLabelStartPos = n));
        };
      })(g || (g = {}));
      ('');
      return g;
    },
  );
  M(
    a,
    'Series/Column/ColumnDataLabel.js',
    [
      a['Core/Series/DataLabel.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { series: x } = A,
        { merge: C, pick: z } = G;
      var D;
      (function (B) {
        function u(a, m, q, h, g) {
          let d = this.chart.inverted;
          var k = a.series;
          let v = (k.xAxis ? k.xAxis.len : this.chart.plotSizeX) || 0;
          k = (k.yAxis ? k.yAxis.len : this.chart.plotSizeY) || 0;
          var r = a.dlBox || a.shapeArgs;
          let u = z(a.below, a.plotY > z(this.translatedThreshold, k)),
            f = z(q.inside, !!this.options.stacking);
          r &&
            ((h = C(r)),
            0 > h.y && ((h.height += h.y), (h.y = 0)),
            (r = h.y + h.height - k),
            0 < r && r < h.height && (h.height -= r),
            d &&
              (h = {
                x: k - h.y - h.height,
                y: v - h.x - h.width,
                width: h.height,
                height: h.width,
              }),
            f ||
              (d
                ? ((h.x += u ? 0 : h.width), (h.width = 0))
                : ((h.y += u ? h.height : 0), (h.height = 0))));
          q.align = z(q.align, !d || f ? 'center' : u ? 'right' : 'left');
          q.verticalAlign = z(
            q.verticalAlign,
            d || f ? 'middle' : u ? 'top' : 'bottom',
          );
          x.prototype.alignDataLabel.call(this, a, m, q, h, g);
          q.inside && a.contrastColor && m.css({ color: a.contrastColor });
        }
        const q = [];
        B.compose = function (r) {
          a.compose(x);
          G.pushUnique(q, r) && (r.prototype.alignDataLabel = u);
        };
      })(D || (D = {}));
      return D;
    },
  );
  M(
    a,
    'Series/Bar/BarSeries.js',
    [
      a['Series/Column/ColumnSeries.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { extend: x, merge: C } = G;
      class z extends a {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
      }
      z.defaultOptions = C(a.defaultOptions, {});
      x(z.prototype, { inverted: !0 });
      A.registerSeriesType('bar', z);
      ('');
      return z;
    },
  );
  M(a, 'Series/Scatter/ScatterSeriesDefaults.js', [], function () {
    '';
    return {
      lineWidth: 0,
      findNearestPointBy: 'xy',
      jitter: { x: 0, y: 0 },
      marker: { enabled: !0 },
      tooltip: {
        headerFormat:
          '<span style="color:{point.color}">\u25cf</span> <span style="font-size: 0.8em"> {series.name}</span><br/>',
        pointFormat: 'x: <b>{point.x}</b><br/>y: <b>{point.y}</b><br/>',
      },
    };
  });
  M(
    a,
    'Series/Scatter/ScatterSeries.js',
    [
      a['Series/Scatter/ScatterSeriesDefaults.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { column: x, line: C } = A.seriesTypes,
        { addEvent: z, extend: D, merge: B } = G;
      class u extends C {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
        applyJitter() {
          const a = this,
            r = this.options.jitter,
            m = this.points.length;
          r &&
            this.points.forEach(function (q, h) {
              ['x', 'y'].forEach(function (g, d) {
                let k = 'plot' + g.toUpperCase(),
                  v,
                  u;
                if (r[g] && !q.isNull) {
                  var x = a[g + 'Axis'];
                  u = r[g] * x.transA;
                  x &&
                    !x.isLog &&
                    ((v = Math.max(0, q[k] - u)),
                    (x = Math.min(x.len, q[k] + u)),
                    (d = 1e4 * Math.sin(h + d * m)),
                    (d -= Math.floor(d)),
                    (q[k] = v + (x - v) * d),
                    'x' === g && (q.clientX = q.plotX));
                }
              });
            });
        }
        drawGraph() {
          this.options.lineWidth
            ? super.drawGraph()
            : this.graph && (this.graph = this.graph.destroy());
        }
      }
      u.defaultOptions = B(C.defaultOptions, a);
      D(u.prototype, {
        drawTracker: x.prototype.drawTracker,
        sorted: !1,
        requireSorting: !1,
        noSharedTooltip: !0,
        trackerGroups: ['group', 'markerGroup', 'dataLabelsGroup'],
        takeOrdinalPosition: !1,
      });
      z(u, 'afterTranslate', function () {
        this.applyJitter();
      });
      A.registerSeriesType('scatter', u);
      return u;
    },
  );
  M(
    a,
    'Series/CenteredUtilities.js',
    [a['Core/Globals.js'], a['Core/Series/Series.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      const { deg2rad: x } = a,
        { fireEvent: C, isNumber: z, pick: D, relativeLength: B } = G;
      var u;
      (function (a) {
        a.getCenter = function () {
          var a = this.options,
            m = this.chart;
          const q = 2 * (a.slicedOffset || 0),
            h = m.plotWidth - 2 * q,
            g = m.plotHeight - 2 * q;
          var d = a.center;
          const k = Math.min(h, g),
            y = a.thickness;
          var u = a.size;
          let x = a.innerSize || 0;
          'string' === typeof u && (u = parseFloat(u));
          'string' === typeof x && (x = parseFloat(x));
          a = [
            D(d[0], '50%'),
            D(d[1], '50%'),
            D(u && 0 > u ? void 0 : a.size, '100%'),
            D(x && 0 > x ? void 0 : a.innerSize || 0, '0%'),
          ];
          !m.angular || this instanceof A || (a[3] = 0);
          for (d = 0; 4 > d; ++d)
            ((u = a[d]),
              (m = 2 > d || (2 === d && /%$/.test(u))),
              (a[d] = B(u, [h, g, k, a[2]][d]) + (m ? q : 0)));
          a[3] > a[2] && (a[3] = a[2]);
          z(y) && 2 * y < a[2] && 0 < y && (a[3] = a[2] - 2 * y);
          C(this, 'afterGetCenter', { positions: a });
          return a;
        };
        a.getStartAndEndRadians = function (a, m) {
          a = z(a) ? a : 0;
          m = z(m) && m > a && 360 > m - a ? m : a + 360;
          return { start: x * (a + -90), end: x * (m + -90) };
        };
      })(u || (u = {}));
      ('');
      return u;
    },
  );
  M(
    a,
    'Series/Pie/PiePoint.js',
    [
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Series/Point.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      const { setAnimation: x } = a,
        {
          addEvent: C,
          defined: z,
          extend: D,
          isNumber: B,
          pick: u,
          relativeLength: q,
        } = G;
      class r extends A {
        constructor() {
          super(...arguments);
          this.series = this.options = this.labelDistance = void 0;
        }
        getConnectorPath() {
          const a = this.labelPosition,
            q = this.series.options.dataLabels,
            h = this.connectorShapes;
          let g = q.connectorShape;
          h[g] && (g = h[g]);
          return g.call(
            this,
            { x: a.computed.x, y: a.computed.y, alignment: a.alignment },
            a.connectorPosition,
            q,
          );
        }
        getTranslate() {
          return this.sliced
            ? this.slicedTranslation
            : { translateX: 0, translateY: 0 };
        }
        haloPath(a) {
          const m = this.shapeArgs;
          return this.sliced || !this.visible
            ? []
            : this.series.chart.renderer.symbols.arc(
                m.x,
                m.y,
                m.r + a,
                m.r + a,
                {
                  innerR: m.r - 1,
                  start: m.start,
                  end: m.end,
                  borderRadius: m.borderRadius,
                },
              );
        }
        init() {
          super.init.apply(this, arguments);
          this.name = u(this.name, 'Slice');
          const a = (a) => {
            this.slice('select' === a.type);
          };
          C(this, 'select', a);
          C(this, 'unselect', a);
          return this;
        }
        isValid() {
          return B(this.y) && 0 <= this.y;
        }
        setVisible(a, q) {
          const h = this.series,
            g = h.chart,
            d = h.options.ignoreHiddenPoint;
          q = u(q, d);
          a !== this.visible &&
            ((this.visible =
              this.options.visible =
              a =
                'undefined' === typeof a ? !this.visible : a),
            (h.options.data[h.data.indexOf(this)] = this.options),
            ['graphic', 'dataLabel', 'connector'].forEach((d) => {
              if (this[d]) this[d][a ? 'show' : 'hide'](a);
            }),
            this.legendItem && g.legend.colorizeItem(this, a),
            a || 'hover' !== this.state || this.setState(''),
            d && (h.isDirty = !0),
            q && g.redraw());
        }
        slice(a, q, h) {
          const g = this.series;
          x(h, g.chart);
          u(q, !0);
          this.sliced = this.options.sliced = z(a) ? a : !this.sliced;
          g.options.data[g.data.indexOf(this)] = this.options;
          this.graphic && this.graphic.animate(this.getTranslate());
        }
      }
      D(r.prototype, {
        connectorShapes: {
          fixedOffset: function (a, q, h) {
            const g = q.breakAt;
            q = q.touchingSliceAt;
            return [
              ['M', a.x, a.y],
              h.softConnector
                ? [
                    'C',
                    a.x + ('left' === a.alignment ? -5 : 5),
                    a.y,
                    2 * g.x - q.x,
                    2 * g.y - q.y,
                    g.x,
                    g.y,
                  ]
                : ['L', g.x, g.y],
              ['L', q.x, q.y],
            ];
          },
          straight: function (a, q) {
            q = q.touchingSliceAt;
            return [
              ['M', a.x, a.y],
              ['L', q.x, q.y],
            ];
          },
          crookedLine: function (a, v, h) {
            const { breakAt: g, touchingSliceAt: d } = v;
            ({ series: v } = this);
            const [k, m, r] = v.center,
              u = r / 2,
              f = v.chart.plotWidth,
              p = v.chart.plotLeft;
            v = 'left' === a.alignment;
            const { x: t, y: n } = a;
            h.crookDistance
              ? ((a = q(h.crookDistance, 1)),
                (a = v ? k + u + (f + p - k - u) * (1 - a) : p + (k - u) * a))
              : (a = k + (m - n) * Math.tan((this.angle || 0) - Math.PI / 2));
            h = [['M', t, n]];
            (v ? a <= t && a >= g.x : a >= t && a <= g.x) &&
              h.push(['L', a, n]);
            h.push(['L', g.x, g.y], ['L', d.x, d.y]);
            return h;
          },
        },
      });
      return r;
    },
  );
  M(a, 'Series/Pie/PieSeriesDefaults.js', [], function () {
    '';
    return {
      borderRadius: 3,
      center: [null, null],
      clip: !1,
      colorByPoint: !0,
      dataLabels: {
        allowOverlap: !0,
        connectorPadding: 5,
        connectorShape: 'crookedLine',
        crookDistance: void 0,
        distance: 30,
        enabled: !0,
        formatter: function () {
          return this.point.isNull ? void 0 : this.point.name;
        },
        softConnector: !0,
        x: 0,
      },
      fillColor: void 0,
      ignoreHiddenPoint: !0,
      inactiveOtherPoints: !0,
      legendType: 'point',
      marker: null,
      size: null,
      showInLegend: !1,
      slicedOffset: 10,
      stickyTracking: !1,
      tooltip: { followPointer: !0 },
      borderColor: '#ffffff',
      borderWidth: 1,
      lineWidth: void 0,
      states: { hover: { brightness: 0.1 } },
    };
  });
  M(
    a,
    'Series/Pie/PieSeries.js',
    [
      a['Series/CenteredUtilities.js'],
      a['Series/Column/ColumnSeries.js'],
      a['Core/Globals.js'],
      a['Series/Pie/PiePoint.js'],
      a['Series/Pie/PieSeriesDefaults.js'],
      a['Core/Series/Series.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Renderer/SVG/Symbols.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D, B, u) {
      const { getStartAndEndRadians: q } = a;
      ({ noop: G } = G);
      const {
        clamp: r,
        extend: m,
        fireEvent: v,
        merge: h,
        pick: g,
        relativeLength: d,
      } = u;
      class k extends z {
        constructor() {
          super(...arguments);
          this.points =
            this.options =
            this.maxLabelDistance =
            this.data =
            this.center =
              void 0;
        }
        animate(a) {
          const d = this,
            k = d.points,
            f = d.startAngleRad;
          a ||
            k.forEach(function (a) {
              const k = a.graphic,
                n = a.shapeArgs;
              k &&
                n &&
                (k.attr({
                  r: g(a.startR, d.center && d.center[3] / 2),
                  start: f,
                  end: f,
                }),
                k.animate(
                  { r: n.r, start: n.start, end: n.end },
                  d.options.animation,
                ));
            });
        }
        drawEmpty() {
          const a = this.startAngleRad,
            d = this.endAngleRad,
            g = this.options;
          let f, k;
          0 === this.total && this.center
            ? ((f = this.center[0]),
              (k = this.center[1]),
              this.graph ||
                (this.graph = this.chart.renderer
                  .arc(f, k, this.center[1] / 2, 0, a, d)
                  .addClass('highcharts-empty-series')
                  .add(this.group)),
              this.graph.attr({
                d: B.arc(f, k, this.center[2] / 2, 0, {
                  start: a,
                  end: d,
                  innerR: this.center[3] / 2,
                }),
              }),
              this.chart.styledMode ||
                this.graph.attr({
                  'stroke-width': g.borderWidth,
                  fill: g.fillColor || 'none',
                  stroke: g.color || '#cccccc',
                }))
            : this.graph && (this.graph = this.graph.destroy());
        }
        drawPoints() {
          const a = this.chart.renderer;
          this.points.forEach(function (d) {
            d.graphic &&
              d.hasNewShapeType() &&
              (d.graphic = d.graphic.destroy());
            d.graphic ||
              ((d.graphic = a[d.shapeType](d.shapeArgs).add(d.series.group)),
              (d.delayedRendering = !0));
          });
        }
        generatePoints() {
          super.generatePoints();
          this.updateTotals();
        }
        getX(a, d, g) {
          const f = this.center,
            k = this.radii ? this.radii[g.index] || 0 : f[2] / 2;
          a = Math.asin(r((a - f[1]) / (k + g.labelDistance), -1, 1));
          return (
            f[0] +
            (d ? -1 : 1) * Math.cos(a) * (k + g.labelDistance) +
            (0 < g.labelDistance
              ? (d ? -1 : 1) * this.options.dataLabels.padding
              : 0)
          );
        }
        hasData() {
          return !!this.processedXData.length;
        }
        redrawPoints() {
          const a = this,
            d = a.chart;
          let g, f, k, m;
          this.drawEmpty();
          a.group && !d.styledMode && a.group.shadow(a.options.shadow);
          a.points.forEach(function (n) {
            const p = {};
            f = n.graphic;
            !n.isNull && f
              ? ((m = n.shapeArgs),
                (g = n.getTranslate()),
                d.styledMode || (k = a.pointAttribs(n, n.selected && 'select')),
                n.delayedRendering
                  ? (f.setRadialReference(a.center).attr(m).attr(g),
                    d.styledMode ||
                      f.attr(k).attr({ 'stroke-linejoin': 'round' }),
                    (n.delayedRendering = !1))
                  : (f.setRadialReference(a.center),
                    d.styledMode || h(!0, p, k),
                    h(!0, p, m, g),
                    f.animate(p)),
                f.attr({ visibility: n.visible ? 'inherit' : 'hidden' }),
                f.addClass(n.getClassName(), !0))
              : f && (n.graphic = f.destroy());
          });
        }
        sortByAngle(a, d) {
          a.sort(function (a, f) {
            return 'undefined' !== typeof a.angle && (f.angle - a.angle) * d;
          });
        }
        translate(a) {
          v(this, 'translate');
          this.generatePoints();
          var k = this.options;
          const h = k.slicedOffset,
            f = h + (k.borderWidth || 0);
          var p = q(k.startAngle, k.endAngle);
          const m = (this.startAngleRad = p.start);
          p = (this.endAngleRad = p.end) - m;
          const n = this.points,
            w = k.dataLabels.distance;
          k = k.ignoreHiddenPoint;
          const e = n.length;
          let b,
            c,
            l,
            r = 0;
          a || (this.center = a = this.getCenter());
          for (c = 0; c < e; c++) {
            l = n[c];
            var y = m + r * p;
            !l.isValid() || (k && !l.visible) || (r += l.percentage / 100);
            var u = m + r * p;
            var x = {
              x: a[0],
              y: a[1],
              r: a[2] / 2,
              innerR: a[3] / 2,
              start: Math.round(1e3 * y) / 1e3,
              end: Math.round(1e3 * u) / 1e3,
            };
            l.shapeType = 'arc';
            l.shapeArgs = x;
            l.labelDistance = g(
              l.options.dataLabels && l.options.dataLabels.distance,
              w,
            );
            l.labelDistance = d(l.labelDistance, x.r);
            this.maxLabelDistance = Math.max(
              this.maxLabelDistance || 0,
              l.labelDistance,
            );
            u = (u + y) / 2;
            u > 1.5 * Math.PI
              ? (u -= 2 * Math.PI)
              : u < -Math.PI / 2 && (u += 2 * Math.PI);
            l.slicedTranslation = {
              translateX: Math.round(Math.cos(u) * h),
              translateY: Math.round(Math.sin(u) * h),
            };
            x = (Math.cos(u) * a[2]) / 2;
            b = (Math.sin(u) * a[2]) / 2;
            l.tooltipPos = [a[0] + 0.7 * x, a[1] + 0.7 * b];
            l.half = u < -Math.PI / 2 || u > Math.PI / 2 ? 1 : 0;
            l.angle = u;
            y = Math.min(f, l.labelDistance / 5);
            l.labelPosition = {
              natural: {
                x: a[0] + x + Math.cos(u) * l.labelDistance,
                y: a[1] + b + Math.sin(u) * l.labelDistance,
              },
              computed: {},
              alignment:
                0 > l.labelDistance ? 'center' : l.half ? 'right' : 'left',
              connectorPosition: {
                breakAt: {
                  x: a[0] + x + Math.cos(u) * y,
                  y: a[1] + b + Math.sin(u) * y,
                },
                touchingSliceAt: { x: a[0] + x, y: a[1] + b },
              },
            };
          }
          v(this, 'afterTranslate');
        }
        updateTotals() {
          const a = this.points,
            d = a.length,
            g = this.options.ignoreHiddenPoint;
          let f,
            k,
            h = 0;
          for (f = 0; f < d; f++)
            ((k = a[f]), !k.isValid() || (g && !k.visible) || (h += k.y));
          this.total = h;
          for (f = 0; f < d; f++)
            ((k = a[f]),
              (k.percentage = 0 < h && (k.visible || !g) ? (k.y / h) * 100 : 0),
              (k.total = h));
        }
      }
      k.defaultOptions = h(z.defaultOptions, C);
      m(k.prototype, {
        axisTypes: [],
        directTouch: !0,
        drawGraph: void 0,
        drawTracker: A.prototype.drawTracker,
        getCenter: a.getCenter,
        getSymbol: G,
        isCartesian: !1,
        noSharedTooltip: !0,
        pointAttribs: A.prototype.pointAttribs,
        pointClass: H,
        requireSorting: !1,
        searchPoint: G,
        trackerGroups: ['group', 'dataLabelsGroup'],
      });
      D.registerSeriesType('pie', k);
      return k;
    },
  );
  M(
    a,
    'Series/Pie/PieDataLabel.js',
    [
      a['Core/Series/DataLabel.js'],
      a['Core/Globals.js'],
      a['Core/Renderer/RendererUtilities.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C) {
      const { noop: x } = A,
        { distribute: D } = G,
        { series: B } = H,
        {
          arrayMax: u,
          clamp: q,
          defined: r,
          merge: m,
          pick: v,
          relativeLength: h,
        } = C;
      var g;
      (function (d) {
        function g() {
          const a = this,
            d = a.data,
            f = a.chart,
            g = a.options.dataLabels || {},
            e = g.connectorPadding,
            b = f.plotWidth,
            c = f.plotHeight,
            l = f.plotLeft,
            k = Math.round(f.chartWidth / 3),
            h = a.center,
            q = h[2] / 2,
            y = h[1],
            x = [[], []],
            O = [0, 0, 0, 0],
            K = a.dataLabelPositioners;
          let z, E, L, A, C, G, H, M, R, T, V, Z;
          a.visible &&
            (g.enabled || a._hasPointLabels) &&
            (d.forEach(function (b) {
              b.dataLabel &&
                b.visible &&
                b.dataLabel.shortened &&
                (b.dataLabel
                  .attr({ width: 'auto' })
                  .css({ width: 'auto', textOverflow: 'clip' }),
                (b.dataLabel.shortened = !1));
            }),
            B.prototype.drawDataLabels.apply(a),
            d.forEach(function (b) {
              b.dataLabel &&
                (b.visible
                  ? (x[b.half].push(b),
                    (b.dataLabel._pos = null),
                    !r(g.style.width) &&
                      !r(
                        b.options.dataLabels &&
                          b.options.dataLabels.style &&
                          b.options.dataLabels.style.width,
                      ) &&
                      b.dataLabel.getBBox().width > k &&
                      (b.dataLabel.css({ width: Math.round(0.7 * k) + 'px' }),
                      (b.dataLabel.shortened = !0)))
                  : ((b.dataLabel = b.dataLabel.destroy()),
                    b.dataLabels &&
                      1 === b.dataLabels.length &&
                      delete b.dataLabels));
            }),
            x.forEach((d, k) => {
              const n = d.length,
                p = [];
              let m,
                t = 0;
              if (n) {
                a.sortByAngle(d, k - 0.5);
                if (0 < a.maxLabelDistance) {
                  var w = Math.max(0, y - q - a.maxLabelDistance);
                  m = Math.min(y + q + a.maxLabelDistance, f.plotHeight);
                  d.forEach(function (b) {
                    0 < b.labelDistance &&
                      b.dataLabel &&
                      ((b.top = Math.max(0, y - q - b.labelDistance)),
                      (b.bottom = Math.min(
                        y + q + b.labelDistance,
                        f.plotHeight,
                      )),
                      (t = b.dataLabel.getBBox().height || 21),
                      (b.distributeBox = {
                        target: b.labelPosition.natural.y - b.top + t / 2,
                        size: t,
                        rank: b.y,
                      }),
                      p.push(b.distributeBox));
                  });
                  w = m + t - w;
                  D(p, w, w / 5);
                }
                for (V = 0; V < n; V++) {
                  z = d[V];
                  G = z.labelPosition;
                  A = z.dataLabel;
                  T = !1 === z.visible ? 'hidden' : 'inherit';
                  R = w = G.natural.y;
                  p &&
                    r(z.distributeBox) &&
                    ('undefined' === typeof z.distributeBox.pos
                      ? (T = 'hidden')
                      : ((H = z.distributeBox.size),
                        (R = K.radialDistributionY(z))));
                  delete z.positionIndex;
                  if (g.justify) M = K.justify(z, q, h);
                  else
                    switch (g.alignTo) {
                      case 'connectors':
                        M = K.alignToConnectors(d, k, b, l);
                        break;
                      case 'plotEdges':
                        M = K.alignToPlotEdges(A, k, b, l);
                        break;
                      default:
                        M = K.radialDistributionX(a, z, R, w);
                    }
                  A._attr = { visibility: T, align: G.alignment };
                  Z = z.options.dataLabels || {};
                  A._pos = {
                    x:
                      M +
                      v(Z.x, g.x) +
                      ({ left: e, right: -e }[G.alignment] || 0),
                    y: R + v(Z.y, g.y) - A.getBBox().height / 2,
                  };
                  G && ((G.computed.x = M), (G.computed.y = R));
                  v(g.crop, !0) &&
                    ((C = A.getBBox().width),
                    (w = null),
                    M - C < e && 1 === k
                      ? ((w = Math.round(C - M + e)),
                        (O[3] = Math.max(w, O[3])))
                      : M + C > b - e &&
                        0 === k &&
                        ((w = Math.round(M + C - b + e)),
                        (O[1] = Math.max(w, O[1]))),
                    0 > R - H / 2
                      ? (O[0] = Math.max(Math.round(-R + H / 2), O[0]))
                      : R + H / 2 > c &&
                        (O[2] = Math.max(Math.round(R + H / 2 - c), O[2])),
                    (A.sideOverflow = w));
                }
              }
            }),
            0 === u(O) || this.verifyDataLabelOverflow(O)) &&
            (this.placeDataLabels(),
            this.points.forEach(function (b) {
              Z = m(g, b.options.dataLabels);
              if ((E = v(Z.connectorWidth, 1))) {
                let c;
                L = b.connector;
                if (
                  (A = b.dataLabel) &&
                  A._pos &&
                  b.visible &&
                  0 < b.labelDistance
                ) {
                  T = A._attr.visibility;
                  if ((c = !L))
                    ((b.connector = L =
                      f.renderer
                        .path()
                        .addClass(
                          'highcharts-data-label-connector  highcharts-color-' +
                            b.colorIndex +
                            (b.className ? ' ' + b.className : ''),
                        )
                        .add(a.dataLabelsGroup)),
                      f.styledMode ||
                        L.attr({
                          'stroke-width': E,
                          stroke: Z.connectorColor || b.color || '#666666',
                        }));
                  L[c ? 'attr' : 'animate']({ d: b.getConnectorPath() });
                  L.attr('visibility', T);
                } else L && (b.connector = L.destroy());
              }
            }));
        }
        function y() {
          this.points.forEach(function (a) {
            let d = a.dataLabel,
              f;
            d &&
              a.visible &&
              ((f = d._pos)
                ? (d.sideOverflow &&
                    ((d._attr.width = Math.max(
                      d.getBBox().width - d.sideOverflow,
                      0,
                    )),
                    d.css({
                      width: d._attr.width + 'px',
                      textOverflow:
                        (this.options.dataLabels.style || {}).textOverflow ||
                        'ellipsis',
                    }),
                    (d.shortened = !0)),
                  d.attr(d._attr),
                  d[d.moved ? 'animate' : 'attr'](f),
                  (d.moved = !0))
                : d && d.attr({ y: -9999 }));
            delete a.distributeBox;
          }, this);
        }
        function K(a) {
          let d = this.center,
            f = this.options,
            g = f.center,
            e = f.minSize || 80,
            b,
            c = null !== f.size;
          c ||
            (null !== g[0]
              ? (b = Math.max(d[2] - Math.max(a[1], a[3]), e))
              : ((b = Math.max(d[2] - a[1] - a[3], e)),
                (d[0] += (a[3] - a[1]) / 2)),
            null !== g[1]
              ? (b = q(b, e, d[2] - Math.max(a[0], a[2])))
              : ((b = q(b, e, d[2] - a[0] - a[2])),
                (d[1] += (a[0] - a[2]) / 2)),
            b < d[2]
              ? ((d[2] = b),
                (d[3] = Math.min(
                  f.thickness
                    ? Math.max(0, b - 2 * f.thickness)
                    : Math.max(0, h(f.innerSize || 0, b)),
                  b,
                )),
                this.translate(d),
                this.drawDataLabels && this.drawDataLabels())
              : (c = !0));
          return c;
        }
        const z = [],
          f = {
            radialDistributionY: function (a) {
              return a.top + a.distributeBox.pos;
            },
            radialDistributionX: function (a, d, f, g) {
              return a.getX(
                f < d.top + 2 || f > d.bottom - 2 ? g : f,
                d.half,
                d,
              );
            },
            justify: function (a, d, f) {
              return f[0] + (a.half ? -1 : 1) * (d + a.labelDistance);
            },
            alignToPlotEdges: function (a, d, f, g) {
              a = a.getBBox().width;
              return d ? a + g : f - a - g;
            },
            alignToConnectors: function (a, d, f, g) {
              let e = 0,
                b;
              a.forEach(function (a) {
                b = a.dataLabel.getBBox().width;
                b > e && (e = b);
              });
              return d ? e + g : f - e - g;
            },
          };
        d.compose = function (d) {
          a.compose(B);
          C.pushUnique(z, d) &&
            ((d = d.prototype),
            (d.dataLabelPositioners = f),
            (d.alignDataLabel = x),
            (d.drawDataLabels = g),
            (d.placeDataLabels = y),
            (d.verifyDataLabelOverflow = K));
        };
      })(g || (g = {}));
      return g;
    },
  );
  M(
    a,
    'Extensions/OverlappingDataLabels.js',
    [a['Core/Chart/Chart.js'], a['Core/Utilities.js']],
    function (a, A) {
      function x(a, r) {
        let m,
          q = !1;
        a &&
          ((m = a.newOpacity),
          a.oldOpacity !== m &&
            (a.alignAttr && a.placed
              ? (a[m ? 'removeClass' : 'addClass'](
                  'highcharts-data-label-hidden',
                ),
                (q = !0),
                (a.alignAttr.opacity = m),
                a[a.isOld ? 'animate' : 'attr'](a.alignAttr, null, function () {
                  r.styledMode || a.css({ pointerEvents: m ? 'auto' : 'none' });
                }),
                C(r, 'afterHideOverlappingLabel'))
              : a.attr({ opacity: m })),
          (a.isOld = !0));
        return q;
      }
      const {
        addEvent: H,
        fireEvent: C,
        isArray: z,
        isNumber: D,
        objectEach: B,
        pick: u,
      } = A;
      H(a, 'render', function () {
        let a = this,
          r = [];
        (this.labelCollectors || []).forEach(function (a) {
          r = r.concat(a());
        });
        (this.yAxis || []).forEach(function (a) {
          a.stacking &&
            a.options.stackLabels &&
            !a.options.stackLabels.allowOverlap &&
            B(a.stacking.stacks, function (a) {
              B(a, function (a) {
                a.label && r.push(a.label);
              });
            });
        });
        (this.series || []).forEach(function (m) {
          var q = m.options.dataLabels;
          m.visible &&
            (!1 !== q.enabled || m._hasPointLabels) &&
            ((q = (h) =>
              h.forEach((g) => {
                g.visible &&
                  (z(g.dataLabels)
                    ? g.dataLabels
                    : g.dataLabel
                      ? [g.dataLabel]
                      : []
                  ).forEach(function (d) {
                    const k = d.options;
                    d.labelrank = u(
                      k.labelrank,
                      g.labelrank,
                      g.shapeArgs && g.shapeArgs.height,
                    );
                    k.allowOverlap
                      ? ((d.oldOpacity = d.opacity),
                        (d.newOpacity = 1),
                        x(d, a))
                      : r.push(d);
                  });
              })),
            q(m.nodes || []),
            q(m.points));
        });
        this.hideOverlappingLabels(r);
      });
      a.prototype.hideOverlappingLabels = function (a) {
        let q = this,
          m = a.length,
          v = q.renderer;
        var h;
        let g;
        let d,
          k,
          y,
          u = !1;
        var z = function (a) {
          let d, f;
          var g;
          let k = a.box ? 0 : a.padding || 0,
            e = (g = 0),
            b,
            c;
          if (a && (!a.alignAttr || a.placed))
            return (
              (d = a.alignAttr || { x: a.attr('x'), y: a.attr('y') }),
              (f = a.parentGroup),
              a.width ||
                ((g = a.getBBox()),
                (a.width = g.width),
                (a.height = g.height),
                (g = v.fontMetrics(a.element).h)),
              (b = a.width - 2 * k),
              (c = { left: '0', center: '0.5', right: '1' }[a.alignValue])
                ? (e = +c * b)
                : D(a.x) &&
                  Math.round(a.x) !== a.translateX &&
                  (e = a.x - a.translateX),
              {
                x: d.x + (f.translateX || 0) + k - (e || 0),
                y: d.y + (f.translateY || 0) + k - g,
                width: a.width - 2 * k,
                height: a.height - 2 * k,
              }
            );
        };
        for (g = 0; g < m; g++)
          if ((h = a[g]))
            ((h.oldOpacity = h.opacity),
              (h.newOpacity = 1),
              (h.absoluteBox = z(h)));
        a.sort(function (a, d) {
          return (d.labelrank || 0) - (a.labelrank || 0);
        });
        for (g = 0; g < m; g++)
          for (k = (z = a[g]) && z.absoluteBox, h = g + 1; h < m; ++h)
            ((y = (d = a[h]) && d.absoluteBox),
              !k ||
                !y ||
                z === d ||
                0 === z.newOpacity ||
                0 === d.newOpacity ||
                'hidden' === z.visibility ||
                'hidden' === d.visibility ||
                y.x >= k.x + k.width ||
                y.x + y.width <= k.x ||
                y.y >= k.y + k.height ||
                y.y + y.height <= k.y ||
                ((z.labelrank < d.labelrank ? z : d).newOpacity = 0));
        a.forEach(function (a) {
          x(a, q) && (u = !0);
        });
        u && C(q, 'afterHideAllOverlappingLabels');
      };
    },
  );
  M(
    a,
    'Extensions/BorderRadius.js',
    [
      a['Core/Defaults.js'],
      a['Core/Series/Series.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Renderer/SVG/SVGRenderer.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z) {
      const { defaultOptions: x } = a;
      ({ seriesTypes: a } = G);
      const {
          addEvent: B,
          extend: u,
          isObject: q,
          merge: r,
          relativeLength: m,
        } = z,
        v = { radius: 0, scope: 'stack', where: void 0 },
        h = (a, d) => {
          q(a) || (a = { radius: a || 0 });
          return r(v, d, a);
        };
      if (-1 === H.symbolCustomAttribs.indexOf('borderRadius')) {
        H.symbolCustomAttribs.push('borderRadius', 'brBoxHeight', 'brBoxY');
        const g = C.prototype.symbols.arc;
        C.prototype.symbols.arc = function (a, d, h, q, f = {}) {
          a = g(a, d, h, q, f);
          const { innerR: k = 0, r: t = h, start: n = 0, end: w = 0 } = f;
          if (f.open || !f.borderRadius) return a;
          h = w - n;
          d = Math.sin(h / 2);
          f = Math.max(
            Math.min(
              m(f.borderRadius || 0, t - k),
              (t - k) / 2,
              (t * d) / (1 + d),
            ),
            0,
          );
          h = Math.min(f, (h / Math.PI) * 2 * k);
          for (d = a.length - 1; d--; ) {
            {
              let g = void 0,
                k = void 0,
                n = void 0;
              q = a;
              var e = d,
                b = 1 < d ? h : f,
                c = q[e],
                l = q[e + 1];
              'Z' === l[0] && (l = q[0]);
              ('M' !== c[0] && 'L' !== c[0]) || 'A' !== l[0]
                ? 'A' !== c[0] ||
                  ('M' !== l[0] && 'L' !== l[0]) ||
                  ((n = l), (k = c))
                : ((n = c), (k = l), (g = !0));
              if (n && k && k.params) {
                c = k[1];
                var r = k[5];
                l = k.params;
                const { start: a, end: d, cx: f, cy: h } = l;
                var v = r ? c - b : c + b;
                const p = v ? Math.asin(b / v) : 0;
                r = r ? p : -p;
                v *= Math.cos(p);
                g
                  ? ((l.start = a + r),
                    (n[1] = f + v * Math.cos(a)),
                    (n[2] = h + v * Math.sin(a)),
                    q.splice(e + 1, 0, [
                      'A',
                      b,
                      b,
                      0,
                      0,
                      1,
                      f + c * Math.cos(l.start),
                      h + c * Math.sin(l.start),
                    ]))
                  : ((l.end = d - r),
                    (k[6] = f + c * Math.cos(l.end)),
                    (k[7] = h + c * Math.sin(l.end)),
                    q.splice(e + 1, 0, [
                      'A',
                      b,
                      b,
                      0,
                      0,
                      1,
                      f + v * Math.cos(d),
                      h + v * Math.sin(d),
                    ]));
                k[4] = Math.abs(l.end - l.start) < Math.PI ? 0 : 1;
              }
            }
          }
          return a;
        };
        const d = C.prototype.symbols.roundedRect;
        C.prototype.symbols.roundedRect = function (a, g, h, m, f = {}) {
          const k = d(a, g, h, m, f),
            { r: q = 0, brBoxHeight: n = m, brBoxY: w = g } = f;
          var e = g - w,
            b = w + n - (g + m);
          f = -0.1 < e - q ? 0 : q;
          const c = -0.1 < b - q ? 0 : q;
          var l = Math.max(f && e, 0);
          const r = Math.max(c && b, 0);
          b = [a + f, g];
          e = [a + h - f, g];
          const v = [a + h, g + f],
            y = [a + h, g + m - c],
            u = [a + h - c, g + m],
            x = [a + c, g + m],
            O = [a, g + m - c],
            z = [a, g + f];
          if (l) {
            const a = Math.sqrt(Math.pow(f, 2) - Math.pow(f - l, 2));
            b[0] -= a;
            e[0] += a;
            v[1] = z[1] = g + f - l;
          }
          m < f - l &&
            ((l = Math.sqrt(Math.pow(f, 2) - Math.pow(f - l - m, 2))),
            (v[0] = y[0] = a + h - f + l),
            (u[0] = Math.min(v[0], u[0])),
            (x[0] = Math.max(y[0], x[0])),
            (O[0] = z[0] = a + f - l),
            (v[1] = z[1] = g + m));
          r &&
            ((l = Math.sqrt(Math.pow(c, 2) - Math.pow(c - r, 2))),
            (u[0] += l),
            (x[0] -= l),
            (y[1] = O[1] = g + m - c + r));
          m < c - r &&
            ((m = Math.sqrt(Math.pow(c, 2) - Math.pow(c - r - m, 2))),
            (v[0] = y[0] = a + h - c + m),
            (e[0] = Math.min(v[0], e[0])),
            (b[0] = Math.max(y[0], b[0])),
            (O[0] = z[0] = a + c - m),
            (y[1] = O[1] = g));
          k.length = 0;
          k.push(
            ['M', ...b],
            ['L', ...e],
            ['A', f, f, 0, 0, 1, ...v],
            ['L', ...y],
            ['A', c, c, 0, 0, 1, ...u],
            ['L', ...x],
            ['A', c, c, 0, 0, 1, ...O],
            ['L', ...z],
            ['A', f, f, 0, 0, 1, ...b],
            ['Z'],
          );
          return k;
        };
        B(a.pie, 'afterTranslate', function () {
          const a = h(this.options.borderRadius);
          for (const d of this.points) {
            const g = d.shapeArgs;
            g && (g.borderRadius = m(a.radius, (g.r || 0) - (g.innerR || 0)));
          }
        });
        B(
          A,
          'afterColumnTranslate',
          function () {
            var a, d;
            if (
              this.options.borderRadius &&
              (!this.chart.is3d || !this.chart.is3d())
            ) {
              const { options: k, yAxis: t } = this,
                n = 'percent' === k.stacking;
              var g =
                null ===
                  (d =
                    null === (a = x.plotOptions) || void 0 === a
                      ? void 0
                      : a[this.type]) || void 0 === d
                  ? void 0
                  : d.borderRadius;
              a = h(k.borderRadius, q(g) ? g : {});
              d = t.options.reversed;
              for (const h of this.points)
                if (
                  (({ shapeArgs: g } = h), 'roundedRect' === h.shapeType && g)
                ) {
                  const { width: e = 0, height: b = 0, y: c = 0 } = g;
                  var r = c,
                    f = b;
                  'stack' === a.scope &&
                    h.stackTotal &&
                    ((r = t.translate(n ? 100 : h.stackTotal, !1, !0, !1, !0)),
                    (f = t.translate(k.threshold || 0, !1, !0, !1, !0)),
                    (f = this.crispCol(0, Math.min(r, f), 0, Math.abs(r - f))),
                    (r = f.y),
                    (f = f.height));
                  const l = -1 === (h.negative ? -1 : 1) * (d ? -1 : 1);
                  let p = a.where;
                  !p &&
                    this.is('waterfall') &&
                    Math.abs(
                      (h.yBottom || 0) - (this.translatedThreshold || 0),
                    ) > this.borderWidth &&
                    (p = 'all');
                  p || (p = 'end');
                  const q =
                    Math.min(
                      m(a.radius, e),
                      e / 2,
                      'all' === p ? b / 2 : Infinity,
                    ) || 0;
                  'end' === p && (l && (r -= q), (f += q));
                  u(g, { brBoxHeight: f, brBoxY: r, r: q });
                }
            }
          },
          { order: 9 },
        );
      }
      A = { optionsToObject: h };
      ('');
      return A;
    },
  );
  M(a, 'Core/Responsive.js', [a['Core/Utilities.js']], function (a) {
    const {
      diffObjects: x,
      extend: G,
      find: H,
      merge: C,
      pick: z,
      uniqueKey: D,
    } = a;
    var B;
    (function (u) {
      function q(a, h) {
        const g = a.condition;
        (
          g.callback ||
          function () {
            return (
              this.chartWidth <= z(g.maxWidth, Number.MAX_VALUE) &&
              this.chartHeight <= z(g.maxHeight, Number.MAX_VALUE) &&
              this.chartWidth >= z(g.minWidth, 0) &&
              this.chartHeight >= z(g.minHeight, 0)
            );
          }
        ).call(this) && h.push(a._id);
      }
      function r(a, h) {
        const g = this.options.responsive;
        var d = this.currentResponsive;
        let k = [];
        !h &&
          g &&
          g.rules &&
          g.rules.forEach((a) => {
            'undefined' === typeof a._id && (a._id = D());
            this.matchResponsiveRule(a, k);
          }, this);
        h = C(
          ...k
            .map((a) => H((g || {}).rules || [], (d) => d._id === a))
            .map((a) => a && a.chartOptions),
        );
        h.isResponsiveOptions = !0;
        k = k.toString() || void 0;
        k !== (d && d.ruleIds) &&
          (d && this.update(d.undoOptions, a, !0),
          k
            ? ((d = x(h, this.options, !0, this.collectionsWithUpdate)),
              (d.isResponsiveOptions = !0),
              (this.currentResponsive = {
                ruleIds: k,
                mergedOptions: h,
                undoOptions: d,
              }),
              this.update(h, a, !0))
            : (this.currentResponsive = void 0));
      }
      const m = [];
      u.compose = function (v) {
        a.pushUnique(m, v) &&
          G(v.prototype, { matchResponsiveRule: q, setResponsive: r });
        return v;
      };
    })(B || (B = {}));
    ('');
    ('');
    return B;
  });
  M(
    a,
    'masters/highcharts.src.js',
    [
      a['Core/Globals.js'],
      a['Core/Utilities.js'],
      a['Core/Defaults.js'],
      a['Core/Animation/Fx.js'],
      a['Core/Animation/AnimationUtilities.js'],
      a['Core/Renderer/HTML/AST.js'],
      a['Core/Templating.js'],
      a['Core/Renderer/RendererUtilities.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Renderer/SVG/SVGRenderer.js'],
      a['Core/Renderer/HTML/HTMLElement.js'],
      a['Core/Renderer/HTML/HTMLRenderer.js'],
      a['Core/Axis/Axis.js'],
      a['Core/Axis/DateTimeAxis.js'],
      a['Core/Axis/LogarithmicAxis.js'],
      a['Core/Axis/PlotLineOrBand/PlotLineOrBand.js'],
      a['Core/Axis/Tick.js'],
      a['Core/Tooltip.js'],
      a['Core/Series/Point.js'],
      a['Core/Pointer.js'],
      a['Core/Legend/Legend.js'],
      a['Core/Chart/Chart.js'],
      a['Core/Axis/Stacking/StackingAxis.js'],
      a['Core/Axis/Stacking/StackItem.js'],
      a['Core/Series/Series.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Series/Column/ColumnSeries.js'],
      a['Series/Column/ColumnDataLabel.js'],
      a['Series/Pie/PieSeries.js'],
      a['Series/Pie/PieDataLabel.js'],
      a['Core/Series/DataLabel.js'],
      a['Core/Responsive.js'],
      a['Core/Color/Color.js'],
      a['Core/Time.js'],
    ],
    function (
      a,
      A,
      G,
      H,
      C,
      z,
      D,
      B,
      u,
      q,
      r,
      m,
      v,
      h,
      g,
      d,
      k,
      y,
      K,
      L,
      f,
      p,
      t,
      n,
      w,
      e,
      b,
      c,
      l,
      I,
      F,
      J,
      S,
      P,
    ) {
      a.animate = C.animate;
      a.animObject = C.animObject;
      a.getDeferredAnimation = C.getDeferredAnimation;
      a.setAnimation = C.setAnimation;
      a.stop = C.stop;
      a.timers = H.timers;
      a.AST = z;
      a.Axis = v;
      a.Chart = p;
      a.chart = p.chart;
      a.Fx = H;
      a.Legend = f;
      a.PlotLineOrBand = d;
      a.Point = K;
      a.Pointer = L;
      a.Series = w;
      a.StackItem = n;
      a.SVGElement = u;
      a.SVGRenderer = q;
      a.Templating = D;
      a.Tick = k;
      a.Time = P;
      a.Tooltip = y;
      a.Color = S;
      a.color = S.parse;
      m.compose(q);
      r.compose(u);
      L.compose(p);
      f.compose(p);
      a.defaultOptions = G.defaultOptions;
      a.getOptions = G.getOptions;
      a.time = G.defaultTime;
      a.setOptions = G.setOptions;
      a.dateFormat = D.dateFormat;
      a.format = D.format;
      a.numberFormat = D.numberFormat;
      a.addEvent = A.addEvent;
      a.arrayMax = A.arrayMax;
      a.arrayMin = A.arrayMin;
      a.attr = A.attr;
      a.clearTimeout = A.clearTimeout;
      a.correctFloat = A.correctFloat;
      a.createElement = A.createElement;
      a.css = A.css;
      a.defined = A.defined;
      a.destroyObjectProperties = A.destroyObjectProperties;
      a.discardElement = A.discardElement;
      a.distribute = B.distribute;
      a.erase = A.erase;
      a.error = A.error;
      a.extend = A.extend;
      a.extendClass = A.extendClass;
      a.find = A.find;
      a.fireEvent = A.fireEvent;
      a.getMagnitude = A.getMagnitude;
      a.getStyle = A.getStyle;
      a.inArray = A.inArray;
      a.isArray = A.isArray;
      a.isClass = A.isClass;
      a.isDOMElement = A.isDOMElement;
      a.isFunction = A.isFunction;
      a.isNumber = A.isNumber;
      a.isObject = A.isObject;
      a.isString = A.isString;
      a.keys = A.keys;
      a.merge = A.merge;
      a.normalizeTickInterval = A.normalizeTickInterval;
      a.objectEach = A.objectEach;
      a.offset = A.offset;
      a.pad = A.pad;
      a.pick = A.pick;
      a.pInt = A.pInt;
      a.relativeLength = A.relativeLength;
      a.removeEvent = A.removeEvent;
      a.seriesType = e.seriesType;
      a.splat = A.splat;
      a.stableSort = A.stableSort;
      a.syncTimeout = A.syncTimeout;
      a.timeUnits = A.timeUnits;
      a.uniqueKey = A.uniqueKey;
      a.useSerialIds = A.useSerialIds;
      a.wrap = A.wrap;
      c.compose(b);
      F.compose(w);
      h.compose(v);
      g.compose(v);
      I.compose(l);
      d.compose(v);
      J.compose(p);
      t.compose(v, p, w);
      y.compose(L);
      return a;
    },
  );
  M(
    a,
    'Core/Axis/NavigatorAxisComposition.js',
    [a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A) {
      function x() {
        this.navigatorAxis || (this.navigatorAxis = new m(this));
      }
      function H(a) {
        var h = this.chart,
          g = h.options,
          d = g.navigator;
        const k = this.navigatorAxis,
          m = h.zooming.pinchType;
        g = g.rangeSelector;
        h = h.zooming.type;
        this.isXAxis &&
          ((d && d.enabled) || (g && g.enabled)) &&
          ('y' === h
            ? (a.zoomed = !1)
            : ((!C && 'xy' === h) || (C && 'xy' === m)) &&
              this.options.range &&
              ((d = k.previousZoom),
              B(a.newMin)
                ? (k.previousZoom = [this.min, this.max])
                : d &&
                  ((a.newMin = d[0]),
                  (a.newMax = d[1]),
                  (k.previousZoom = void 0))));
        'undefined' !== typeof a.zoomed && a.preventDefault();
      }
      const { isTouchDevice: C } = a,
        { addEvent: z, correctFloat: D, defined: B, isNumber: u, pick: q } = A,
        r = [];
      class m {
        static compose(a) {
          A.pushUnique(r, a) &&
            (a.keepProps.push('navigatorAxis'),
            z(a, 'init', x),
            z(a, 'zoom', H));
        }
        constructor(a) {
          this.axis = a;
        }
        destroy() {
          this.axis = void 0;
        }
        toFixedRange(a, h, g, d) {
          const k = this.axis;
          var m = k.chart;
          a = q(g, k.translate(a, !0, !k.horiz));
          h = q(d, k.translate(h, !0, !k.horiz));
          m = m && m.fixedRange;
          const r = (k.pointRange || 0) / 2;
          B(g) || (a = D(a + r));
          B(d) || (h = D(h - r));
          m &&
            k.dataMin &&
            k.dataMax &&
            (h >= k.dataMax && (a = D(k.dataMax - m)),
            a <= k.dataMin && (h = D(k.dataMin + m)));
          (u(a) && u(h)) || (a = h = void 0);
          return { min: a, max: h };
        }
      }
      return m;
    },
  );
  M(
    a,
    'Stock/Navigator/NavigatorDefaults.js',
    [a['Core/Color/Color.js'], a['Core/Series/SeriesRegistry.js']],
    function (a, A) {
      ({ parse: a } = a);
      ({ seriesTypes: A } = A);
      A = {
        height: 40,
        margin: 25,
        maskInside: !0,
        handles: {
          width: 7,
          height: 15,
          symbols: ['navigator-handle', 'navigator-handle'],
          enabled: !0,
          lineWidth: 1,
          backgroundColor: '#f2f2f2',
          borderColor: '#999999',
        },
        maskFill: a('#667aff').setOpacity(0.3).get(),
        outlineColor: '#999999',
        outlineWidth: 1,
        series: {
          type: 'undefined' === typeof A.areaspline ? 'line' : 'areaspline',
          fillOpacity: 0.05,
          lineWidth: 1,
          compare: null,
          sonification: { enabled: !1 },
          dataGrouping: {
            approximation: 'average',
            enabled: !0,
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
          dataLabels: { enabled: !1, zIndex: 2 },
          id: 'highcharts-navigator-series',
          className: 'highcharts-navigator-series',
          lineColor: null,
          marker: { enabled: !1 },
          threshold: null,
        },
        xAxis: {
          overscroll: 0,
          className: 'highcharts-navigator-xaxis',
          tickLength: 0,
          lineWidth: 0,
          gridLineColor: '#e6e6e6',
          gridLineWidth: 1,
          tickPixelInterval: 200,
          labels: {
            align: 'left',
            style: {
              color: '#000000',
              fontSize: '0.7em',
              opacity: 0.6,
              textOutline: '2px contrast',
            },
            x: 3,
            y: -4,
          },
          crosshair: !1,
        },
        yAxis: {
          className: 'highcharts-navigator-yaxis',
          gridLineWidth: 0,
          startOnTick: !1,
          endOnTick: !1,
          minPadding: 0.1,
          maxPadding: 0.1,
          labels: { enabled: !1 },
          crosshair: !1,
          title: { text: null },
          tickLength: 0,
          tickWidth: 0,
        },
      };
      ('');
      return A;
    },
  );
  M(a, 'Stock/Navigator/NavigatorSymbols.js', [], function () {
    return {
      'navigator-handle': function (a, A, G, H, C = {}) {
        a = C.width ? C.width / 2 : G;
        A = Math.round(a / 3) + 0.5;
        H = C.height || H;
        return [
          ['M', -a - 1, 0.5],
          ['L', a, 0.5],
          ['L', a, H + 0.5],
          ['L', -a - 1, H + 0.5],
          ['L', -a - 1, 0.5],
          ['M', -A, 4],
          ['L', -A, H - 3],
          ['M', A - 1, 4],
          ['L', A - 1, H - 3],
        ];
      },
    };
  });
  M(
    a,
    'Stock/Navigator/NavigatorComposition.js',
    [
      a['Core/Defaults.js'],
      a['Core/Globals.js'],
      a['Core/Axis/NavigatorAxisComposition.js'],
      a['Stock/Navigator/NavigatorDefaults.js'],
      a['Stock/Navigator/NavigatorSymbols.js'],
      a['Core/Renderer/RendererRegistry.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D) {
      function x() {
        this.navigator && this.navigator.setBaseSeries(null, !1);
      }
      function u() {
        var a;
        const b = this.legend,
          c = this.navigator;
        let d, f, g;
        if (c) {
          d = b && b.options;
          f = c.xAxis;
          g = c.yAxis;
          const { scrollbarHeight: e, scrollButtonSize: l } = c;
          this.inverted
            ? ((c.left = c.opposite
                ? this.chartWidth - e - c.height
                : this.spacing[3] + e),
              (c.top = this.plotTop + l))
            : ((c.left = t(f.left, this.plotLeft + l)),
              (c.top =
                c.navigatorOptions.top ||
                this.chartHeight -
                  c.height -
                  e -
                  ((null === (a = this.scrollbar) || void 0 === a
                    ? void 0
                    : a.options.margin) || 0) -
                  this.spacing[2] -
                  (this.rangeSelector && this.extraBottomMargin
                    ? this.rangeSelector.getHeight()
                    : 0) -
                  (d &&
                  'bottom' === d.verticalAlign &&
                  'proximate' !== d.layout &&
                  d.enabled &&
                  !d.floating
                    ? b.legendHeight + t(d.margin, 10)
                    : 0) -
                  (this.titleOffset ? this.titleOffset[2] : 0)));
          f &&
            g &&
            (this.inverted
              ? (f.options.left = g.options.left = c.left)
              : (f.options.top = g.options.top = c.top),
            f.setAxisSize(),
            g.setAxisSize());
        }
      }
      function q(a) {
        this.navigator ||
          this.scroller ||
          (!this.options.navigator.enabled &&
            !this.options.scrollbar.enabled) ||
          ((this.scroller = this.navigator = new w(this)),
          t(a.redraw, !0) && this.redraw(a.animation));
      }
      function r() {
        const a = this.options;
        if (a.navigator.enabled || a.scrollbar.enabled)
          this.scroller = this.navigator = new w(this);
      }
      function m() {
        var a = this.options;
        const b = a.navigator;
        a = a.rangeSelector;
        if (
          ((b && b.enabled) || (a && a.enabled)) &&
          ((!y && 'x' === this.zooming.type) ||
            (y && 'x' === this.zooming.pinchType))
        )
          return !1;
      }
      function v(a) {
        const b = a.navigator;
        b &&
          a.xAxis[0] &&
          ((a = a.xAxis[0].getExtremes()), b.render(a.min, a.max));
      }
      function h(a) {
        const b = a.options.navigator || {},
          c = a.options.scrollbar || {};
        this.navigator ||
          this.scroller ||
          (!b.enabled && !c.enabled) ||
          (p(!0, this.options.navigator, b),
          p(!0, this.options.scrollbar, c),
          delete a.options.navigator,
          delete a.options.scrollbar);
      }
      function g() {
        this.chart.navigator &&
          !this.options.isInternal &&
          this.chart.navigator.setBaseSeries(null, !1);
      }
      const { defaultOptions: d, setOptions: k } = a,
        { isTouchDevice: y } = A,
        { getRendererType: K } = z,
        { addEvent: L, extend: f, merge: p, pick: t } = D,
        n = [];
      let w;
      return {
        compose: function (a, b, c, l) {
          G.compose(a);
          w = c;
          D.pushUnique(n, b) &&
            (b.prototype.callbacks.push(v),
            L(b, 'afterAddSeries', x),
            L(b, 'afterSetChartSize', u),
            L(b, 'afterUpdate', q),
            L(b, 'beforeRender', r),
            L(b, 'beforeShowResetZoom', m),
            L(b, 'update', h));
          D.pushUnique(n, l) && L(l, 'afterUpdate', g);
          D.pushUnique(n, K) && f(K().prototype.symbols, C);
          D.pushUnique(n, k) && f(d, { navigator: H });
        },
      };
    },
  );
  M(a, 'Core/Axis/ScrollbarAxis.js', [a['Core/Utilities.js']], function (a) {
    const { addEvent: x, defined: G, pick: H } = a,
      C = [];
    class z {
      static compose(z, B) {
        if (!a.pushUnique(C, z)) return z;
        const u = (a) => {
          const q = H(a.options && a.options.min, a.min),
            m = H(a.options && a.options.max, a.max);
          return {
            axisMin: q,
            axisMax: m,
            scrollMin: G(a.dataMin)
              ? Math.min(q, a.min, a.dataMin, H(a.threshold, Infinity))
              : q,
            scrollMax: G(a.dataMax)
              ? Math.max(m, a.max, a.dataMax, H(a.threshold, -Infinity))
              : m,
          };
        };
        x(z, 'afterInit', function () {
          const a = this;
          a.options &&
            a.options.scrollbar &&
            a.options.scrollbar.enabled &&
            ((a.options.scrollbar.vertical = !a.horiz),
            (a.options.startOnTick = a.options.endOnTick = !1),
            (a.scrollbar = new B(
              a.chart.renderer,
              a.options.scrollbar,
              a.chart,
            )),
            x(a.scrollbar, 'changed', function (q) {
              let { axisMin: m, axisMax: r, scrollMin: h, scrollMax: g } = u(a);
              var d = g - h;
              let k;
              G(m) &&
                G(r) &&
                ((a.horiz && !a.reversed) || (!a.horiz && a.reversed)
                  ? ((k = h + d * this.to), (d = h + d * this.from))
                  : ((k = h + d * (1 - this.from)),
                    (d = h + d * (1 - this.to))),
                this.shouldUpdateExtremes(q.DOMType)
                  ? a.setExtremes(
                      d,
                      k,
                      !0,
                      'mousemove' === q.DOMType || 'touchmove' === q.DOMType
                        ? !1
                        : void 0,
                      q,
                    )
                  : this.setRange(this.from, this.to));
            }));
        });
        x(z, 'afterRender', function () {
          let { scrollMin: a, scrollMax: r } = u(this),
            m = this.scrollbar;
          var v = this.axisTitleMargin + (this.titleOffset || 0),
            h = this.chart.scrollbarsOffsets;
          let g = this.options.margin || 0;
          m &&
            (this.horiz
              ? (this.opposite || (h[1] += v),
                m.position(
                  this.left,
                  this.top + this.height + 2 + h[1] - (this.opposite ? g : 0),
                  this.width,
                  this.height,
                ),
                this.opposite || (h[1] += g),
                (v = 1))
              : (this.opposite && (h[0] += v),
                m.position(
                  m.options.opposite
                    ? this.left +
                        this.width +
                        2 +
                        h[0] -
                        (this.opposite ? 0 : g)
                    : this.opposite
                      ? 0
                      : g,
                  this.top,
                  this.width,
                  this.height,
                ),
                this.opposite && (h[0] += g),
                (v = 0)),
            (h[v] += m.size + (m.options.margin || 0)),
            isNaN(a) ||
            isNaN(r) ||
            !G(this.min) ||
            !G(this.max) ||
            this.min === this.max
              ? m.setRange(0, 1)
              : ((h = (this.min - a) / (r - a)),
                (v = (this.max - a) / (r - a)),
                (this.horiz && !this.reversed) || (!this.horiz && this.reversed)
                  ? m.setRange(h, v)
                  : m.setRange(1 - v, 1 - h)));
        });
        x(z, 'afterGetOffset', function () {
          const a = this.scrollbar;
          var r = a && !a.options.opposite;
          r = this.horiz ? 2 : r ? 3 : 1;
          a &&
            ((this.chart.scrollbarsOffsets = [0, 0]),
            (this.chart.axisOffset[r] += a.size + (a.options.margin || 0)));
        });
        return z;
      }
    }
    return z;
  });
  M(
    a,
    'Stock/Scrollbar/ScrollbarDefaults.js',
    [a['Core/Globals.js']],
    function (a) {
      return {
        height: 10,
        barBorderRadius: 5,
        buttonBorderRadius: 0,
        buttonsEnabled: !1,
        liveRedraw: void 0,
        margin: void 0,
        minWidth: 6,
        opposite: !0,
        step: 0.2,
        zIndex: 3,
        barBackgroundColor: '#cccccc',
        barBorderWidth: 0,
        barBorderColor: '#cccccc',
        buttonArrowColor: '#333333',
        buttonBackgroundColor: '#e6e6e6',
        buttonBorderColor: '#cccccc',
        buttonBorderWidth: 1,
        rifleColor: 'none',
        trackBackgroundColor: 'rgba(255, 255, 255, 0.001)',
        trackBorderColor: '#cccccc',
        trackBorderRadius: 5,
        trackBorderWidth: 1,
      };
    },
  );
  M(
    a,
    'Stock/Scrollbar/Scrollbar.js',
    [
      a['Core/Defaults.js'],
      a['Core/Globals.js'],
      a['Core/Axis/ScrollbarAxis.js'],
      a['Stock/Scrollbar/ScrollbarDefaults.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C) {
      const { defaultOptions: z } = a,
        {
          addEvent: x,
          correctFloat: B,
          defined: u,
          destroyObjectProperties: q,
          fireEvent: r,
          merge: m,
          pick: v,
          removeEvent: h,
        } = C;
      class g {
        static compose(a) {
          G.compose(a, g);
        }
        static swapXY(a, g) {
          g &&
            a.forEach((a) => {
              const d = a.length;
              let g;
              for (let f = 0; f < d; f += 2)
                ((g = a[f + 1]),
                  'number' === typeof g &&
                    ((a[f + 1] = a[f + 2]), (a[f + 2] = g)));
            });
          return a;
        }
        constructor(a, g, h) {
          this._events = [];
          this.chart = void 0;
          this.from = this.chartY = this.chartX = 0;
          this.scrollbar = this.renderer = this.options = this.group = void 0;
          this.scrollbarButtons = [];
          this.scrollbarGroup = void 0;
          this.scrollbarLeft = 0;
          this.scrollbarRifles = void 0;
          this.scrollbarStrokeWidth = 1;
          this.to = this.size = this.scrollbarTop = 0;
          this.track = void 0;
          this.trackBorderWidth = 1;
          this.userOptions = void 0;
          this.y = this.x = 0;
          this.init(a, g, h);
        }
        addEvents() {
          var a = this.options.inverted ? [1, 0] : [0, 1];
          const g = this.scrollbarButtons,
            h = this.scrollbarGroup.element,
            m = this.track.element,
            q = this.mouseDownHandler.bind(this),
            f = this.mouseMoveHandler.bind(this),
            p = this.mouseUpHandler.bind(this);
          a = [
            [g[a[0]].element, 'click', this.buttonToMinClick.bind(this)],
            [g[a[1]].element, 'click', this.buttonToMaxClick.bind(this)],
            [m, 'click', this.trackClick.bind(this)],
            [h, 'mousedown', q],
            [h.ownerDocument, 'mousemove', f],
            [h.ownerDocument, 'mouseup', p],
          ];
          A.hasTouch &&
            a.push(
              [h, 'touchstart', q],
              [h.ownerDocument, 'touchmove', f],
              [h.ownerDocument, 'touchend', p],
            );
          a.forEach(function (a) {
            x.apply(null, a);
          });
          this._events = a;
        }
        buttonToMaxClick(a) {
          const d = (this.to - this.from) * v(this.options.step, 0.2);
          this.updatePosition(this.from + d, this.to + d);
          r(this, 'changed', {
            from: this.from,
            to: this.to,
            trigger: 'scrollbar',
            DOMEvent: a,
          });
        }
        buttonToMinClick(a) {
          const d = B(this.to - this.from) * v(this.options.step, 0.2);
          this.updatePosition(B(this.from - d), B(this.to - d));
          r(this, 'changed', {
            from: this.from,
            to: this.to,
            trigger: 'scrollbar',
            DOMEvent: a,
          });
        }
        cursorToScrollbarPosition(a) {
          var d = this.options;
          d = d.minWidth > this.calculatedWidth ? d.minWidth : 0;
          return {
            chartX: (a.chartX - this.x - this.xOffset) / (this.barWidth - d),
            chartY: (a.chartY - this.y - this.yOffset) / (this.barWidth - d),
          };
        }
        destroy() {
          const a = this,
            g = a.chart.scroller;
          a.removeEvents();
          [
            'track',
            'scrollbarRifles',
            'scrollbar',
            'scrollbarGroup',
            'group',
          ].forEach(function (d) {
            a[d] && a[d].destroy && (a[d] = a[d].destroy());
          });
          g &&
            a === g.scrollbar &&
            ((g.scrollbar = null), q(g.scrollbarButtons));
        }
        drawScrollbarButton(a) {
          const d = this.renderer,
            h = this.scrollbarButtons,
            m = this.options,
            q = this.size;
          var f = d.g().add(this.group);
          h.push(f);
          m.buttonsEnabled &&
            ((f = d.rect().addClass('highcharts-scrollbar-button').add(f)),
            this.chart.styledMode ||
              f.attr({
                stroke: m.buttonBorderColor,
                'stroke-width': m.buttonBorderWidth,
                fill: m.buttonBackgroundColor,
              }),
            f.attr(
              f.crisp(
                {
                  x: -0.5,
                  y: -0.5,
                  width: q + 1,
                  height: q + 1,
                  r: m.buttonBorderRadius,
                },
                f.strokeWidth(),
              ),
            ),
            (a = d
              .path(
                g.swapXY(
                  [
                    ['M', q / 2 + (a ? -1 : 1), q / 2 - 3],
                    ['L', q / 2 + (a ? -1 : 1), q / 2 + 3],
                    ['L', q / 2 + (a ? 2 : -2), q / 2],
                  ],
                  m.vertical,
                ),
              )
              .addClass('highcharts-scrollbar-arrow')
              .add(h[a])),
            this.chart.styledMode || a.attr({ fill: m.buttonArrowColor }));
        }
        init(a, g, h) {
          this.scrollbarButtons = [];
          this.renderer = a;
          this.userOptions = g;
          this.options = m(H, z.scrollbar, g);
          this.options.margin = v(this.options.margin, 10);
          this.chart = h;
          this.size = v(this.options.size, this.options.height);
          g.enabled && (this.render(), this.addEvents());
        }
        mouseDownHandler(a) {
          a = this.chart.pointer.normalize(a);
          a = this.cursorToScrollbarPosition(a);
          this.chartX = a.chartX;
          this.chartY = a.chartY;
          this.initPositions = [this.from, this.to];
          this.grabbedCenter = !0;
        }
        mouseMoveHandler(a) {
          var d = this.chart.pointer.normalize(a),
            g = this.options.vertical ? 'chartY' : 'chartX';
          const h = this.initPositions || [];
          !this.grabbedCenter ||
            (a.touches && 0 === a.touches[0][g]) ||
            ((d = this.cursorToScrollbarPosition(d)[g]),
            (g = this[g]),
            (g = d - g),
            (this.hasDragged = !0),
            this.updatePosition(h[0] + g, h[1] + g),
            this.hasDragged &&
              r(this, 'changed', {
                from: this.from,
                to: this.to,
                trigger: 'scrollbar',
                DOMType: a.type,
                DOMEvent: a,
              }));
        }
        mouseUpHandler(a) {
          this.hasDragged &&
            r(this, 'changed', {
              from: this.from,
              to: this.to,
              trigger: 'scrollbar',
              DOMType: a.type,
              DOMEvent: a,
            });
          this.grabbedCenter =
            this.hasDragged =
            this.chartX =
            this.chartY =
              null;
        }
        position(a, g, h, m) {
          const {
              buttonsEnabled: d,
              margin: f = 0,
              vertical: k,
            } = this.options,
            q = this.rendered ? 'animate' : 'attr';
          let n = m,
            w = 0;
          this.group.show();
          this.x = a;
          this.y = g + this.trackBorderWidth;
          this.width = h;
          this.height = m;
          this.xOffset = n;
          this.yOffset = w;
          k
            ? ((this.width = this.yOffset = h = this.size),
              (this.xOffset = n = 0),
              (this.yOffset = w = d ? this.size : 0),
              (this.barWidth = m - (d ? 2 * h : 0)),
              (this.x = a += f))
            : ((this.height = m = this.size),
              (this.xOffset = n = d ? this.size : 0),
              (this.barWidth = h - (d ? 2 * m : 0)),
              (this.y += f));
          this.group[q]({ translateX: a, translateY: this.y });
          this.track[q]({ width: h, height: m });
          this.scrollbarButtons[1][q]({
            translateX: k ? 0 : h - n,
            translateY: k ? m - w : 0,
          });
        }
        removeEvents() {
          this._events.forEach(function (a) {
            h.apply(null, a);
          });
          this._events.length = 0;
        }
        render() {
          const a = this.renderer,
            h = this.options,
            m = this.size,
            q = this.chart.styledMode,
            r = a.g('scrollbar').attr({ zIndex: h.zIndex }).hide().add();
          this.group = r;
          this.track = a
            .rect()
            .addClass('highcharts-scrollbar-track')
            .attr({ r: h.trackBorderRadius || 0, height: m, width: m })
            .add(r);
          q ||
            this.track.attr({
              fill: h.trackBackgroundColor,
              stroke: h.trackBorderColor,
              'stroke-width': h.trackBorderWidth,
            });
          const f = (this.trackBorderWidth = this.track.strokeWidth());
          this.track.attr({ x: (-f % 2) / 2, y: (-f % 2) / 2 });
          this.scrollbarGroup = a.g().add(r);
          this.scrollbar = a
            .rect()
            .addClass('highcharts-scrollbar-thumb')
            .attr({ height: m - f, width: m - f, r: h.barBorderRadius || 0 })
            .add(this.scrollbarGroup);
          this.scrollbarRifles = a
            .path(
              g.swapXY(
                [
                  ['M', -3, m / 4],
                  ['L', -3, (2 * m) / 3],
                  ['M', 0, m / 4],
                  ['L', 0, (2 * m) / 3],
                  ['M', 3, m / 4],
                  ['L', 3, (2 * m) / 3],
                ],
                h.vertical,
              ),
            )
            .addClass('highcharts-scrollbar-rifles')
            .add(this.scrollbarGroup);
          q ||
            (this.scrollbar.attr({
              fill: h.barBackgroundColor,
              stroke: h.barBorderColor,
              'stroke-width': h.barBorderWidth,
            }),
            this.scrollbarRifles.attr({
              stroke: h.rifleColor,
              'stroke-width': 1,
            }));
          this.scrollbarStrokeWidth = this.scrollbar.strokeWidth();
          this.scrollbarGroup.translate(
            (-this.scrollbarStrokeWidth % 2) / 2,
            (-this.scrollbarStrokeWidth % 2) / 2,
          );
          this.drawScrollbarButton(0);
          this.drawScrollbarButton(1);
        }
        setRange(a, g) {
          const d = this.options,
            h = d.vertical;
          var k = d.minWidth,
            f = this.barWidth;
          const p =
            !this.rendered ||
            this.hasDragged ||
            (this.chart.navigator && this.chart.navigator.hasDragged)
              ? 'attr'
              : 'animate';
          if (u(f)) {
            var m = f * Math.min(g, 1);
            a = Math.max(a, 0);
            var n = Math.ceil(f * a);
            this.calculatedWidth = m = B(m - n);
            m < k && ((n = (f - k + m) * a), (m = k));
            k = Math.floor(n + this.xOffset + this.yOffset);
            f = m / 2 - 0.5;
            this.from = a;
            this.to = g;
            h
              ? (this.scrollbarGroup[p]({ translateY: k }),
                this.scrollbar[p]({ height: m }),
                this.scrollbarRifles[p]({ translateY: f }),
                (this.scrollbarTop = k),
                (this.scrollbarLeft = 0))
              : (this.scrollbarGroup[p]({ translateX: k }),
                this.scrollbar[p]({ width: m }),
                this.scrollbarRifles[p]({ translateX: f }),
                (this.scrollbarLeft = k),
                (this.scrollbarTop = 0));
            12 >= m ? this.scrollbarRifles.hide() : this.scrollbarRifles.show();
            !1 === d.showFull &&
              (0 >= a && 1 <= g ? this.group.hide() : this.group.show());
            this.rendered = !0;
          }
        }
        shouldUpdateExtremes(a) {
          return (
            v(
              this.options.liveRedraw,
              A.svg && !A.isTouchDevice && !this.chart.boosted,
            ) ||
            'mouseup' === a ||
            'touchend' === a ||
            !u(a)
          );
        }
        trackClick(a) {
          const d = this.chart.pointer.normalize(a),
            g = this.to - this.from,
            h = this.y + this.scrollbarTop,
            m = this.x + this.scrollbarLeft;
          (this.options.vertical && d.chartY > h) ||
          (!this.options.vertical && d.chartX > m)
            ? this.updatePosition(this.from + g, this.to + g)
            : this.updatePosition(this.from - g, this.to - g);
          r(this, 'changed', {
            from: this.from,
            to: this.to,
            trigger: 'scrollbar',
            DOMEvent: a,
          });
        }
        update(a) {
          this.destroy();
          this.init(this.chart.renderer, m(!0, this.options, a), this.chart);
        }
        updatePosition(a, g) {
          1 < g && ((a = B(1 - B(g - a))), (g = 1));
          0 > a && ((g = B(g - a)), (a = 0));
          this.from = a;
          this.to = g;
        }
      }
      g.defaultOptions = H;
      z.scrollbar = m(!0, g.defaultOptions, z.scrollbar);
      return g;
    },
  );
  M(
    a,
    'Stock/Navigator/Navigator.js',
    [
      a['Core/Axis/Axis.js'],
      a['Core/Defaults.js'],
      a['Core/Globals.js'],
      a['Core/Axis/NavigatorAxisComposition.js'],
      a['Stock/Navigator/NavigatorComposition.js'],
      a['Stock/Scrollbar/Scrollbar.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z, D) {
      function x(b, ...a) {
        a = [].filter.call(a, f);
        if (a.length) return Math[b].apply(0, a);
      }
      const { defaultOptions: u } = A,
        { hasTouch: q, isTouchDevice: r } = G,
        {
          addEvent: m,
          clamp: v,
          correctFloat: h,
          defined: g,
          destroyObjectProperties: d,
          erase: k,
          extend: y,
          find: K,
          isArray: L,
          isNumber: f,
          merge: p,
          pick: t,
          removeEvent: n,
          splat: w,
        } = D;
      class e {
        static compose(b, a, d) {
          C.compose(b, a, e, d);
        }
        constructor(b) {
          this.rendered =
            this.range =
            this.outline =
            this.opposite =
            this.navigatorSize =
            this.navigatorSeries =
            this.navigatorOptions =
            this.navigatorGroup =
            this.navigatorEnabled =
            this.left =
            this.height =
            this.handles =
            this.chart =
            this.baseSeries =
              void 0;
          this.scrollbarHeight = 0;
          this.zoomedMin =
            this.zoomedMax =
            this.yAxis =
            this.xAxis =
            this.top =
            this.size =
            this.shades =
            this.scrollButtonSize =
              void 0;
          this.init(b);
        }
        drawHandle(b, a, e, d) {
          const c = this.navigatorOptions.handles.height;
          this.handles[a][d](
            e
              ? {
                  translateX: Math.round(this.left + this.height / 2),
                  translateY: Math.round(this.top + parseInt(b, 10) + 0.5 - c),
                }
              : {
                  translateX: Math.round(this.left + parseInt(b, 10)),
                  translateY: Math.round(
                    this.top + this.height / 2 - c / 2 - 1,
                  ),
                },
          );
        }
        drawOutline(a, c, e, d) {
          const b = this.navigatorOptions.maskInside;
          var f = this.outline.strokeWidth();
          const g = f / 2;
          var l = (f % 2) / 2;
          const h = this.scrollButtonSize,
            n = this.size,
            k = this.top;
          f = this.height;
          const p = k - g,
            m = k + f;
          let q = this.left;
          e
            ? ((e = k + c + l),
              (c = k + a + l),
              (l = [
                ['M', q + f, k - h - l],
                ['L', q + f, e],
                ['L', q, e],
                ['M', q, c],
                ['L', q + f, c],
                ['L', q + f, k + n + h],
              ]),
              b && l.push(['M', q + f, e - g], ['L', q + f, c + g]))
            : ((q -= h),
              (a += q + h - l),
              (c += q + h - l),
              (l = [
                ['M', q, p],
                ['L', a, p],
                ['L', a, m],
                ['M', c, m],
                ['L', c, p],
                ['L', q + n + 2 * h, k + g],
              ]),
              b && l.push(['M', a - g, p], ['L', c + g, p]));
          this.outline[d]({ d: l });
        }
        drawMasks(a, c, e, d) {
          const b = this.left,
            f = this.top,
            g = this.height;
          let l, h, n, k;
          e
            ? ((n = [b, b, b]),
              (k = [f, f + a, f + c]),
              (h = [g, g, g]),
              (l = [a, c - a, this.size - c]))
            : ((n = [b, b + a, b + c]),
              (k = [f, f, f]),
              (h = [a, c - a, this.size - c]),
              (l = [g, g, g]));
          this.shades.forEach((a, b) => {
            a[d]({ x: n[b], y: k[b], width: h[b], height: l[b] });
          });
        }
        renderElements() {
          const a = this,
            c = a.navigatorOptions,
            e = c.maskInside,
            d = a.chart,
            f = d.renderer,
            g = { cursor: d.inverted ? 'ns-resize' : 'ew-resize' },
            h = (a.navigatorGroup = f
              .g('navigator')
              .attr({ zIndex: 8, visibility: 'hidden' })
              .add());
          [!e, e, !e].forEach((b, e) => {
            const l = f
              .rect()
              .addClass(
                'highcharts-navigator-mask' +
                  (1 === e ? '-inside' : '-outside'),
              )
              .add(h);
            d.styledMode ||
              (l.attr({ fill: b ? c.maskFill : 'rgba(0,0,0,0)' }),
              1 === e && l.css(g));
            a.shades[e] = l;
          });
          a.outline = f.path().addClass('highcharts-navigator-outline').add(h);
          d.styledMode ||
            a.outline.attr({
              'stroke-width': c.outlineWidth,
              stroke: c.outlineColor,
            });
          if (c.handles && c.handles.enabled) {
            const b = c.handles,
              { height: e, width: l } = b;
            [0, 1].forEach((c) => {
              a.handles[c] = f.symbol(b.symbols[c], -l / 2 - 1, 0, l, e, b);
              d.inverted &&
                a.handles[c].attr({
                  rotation: 90,
                  rotationOriginX: Math.floor(-l / 2),
                  rotationOriginY: (e + l) / 2,
                });
              a.handles[c]
                .attr({ zIndex: 7 - c })
                .addClass(
                  'highcharts-navigator-handle highcharts-navigator-handle-' +
                    ['left', 'right'][c],
                )
                .add(h);
              d.styledMode ||
                a.handles[c]
                  .attr({
                    fill: b.backgroundColor,
                    stroke: b.borderColor,
                    'stroke-width': b.lineWidth,
                  })
                  .css(g);
            });
          }
        }
        update(a) {
          (this.series || []).forEach((a) => {
            a.baseSeries && delete a.baseSeries.navigatorSeries;
          });
          this.destroy();
          p(!0, this.chart.options.navigator, a);
          this.init(this.chart);
        }
        render(a, c, e, d) {
          var b = this.chart;
          const l = this.xAxis,
            n = l.pointRange || 0;
          var k = l.navigatorAxis.fake ? b.xAxis[0] : l;
          const p = this.navigatorEnabled;
          var m = this.rendered,
            q = b.inverted;
          const w = b.xAxis[0].minRange,
            r = b.xAxis[0].options.maxRange,
            u = this.scrollButtonSize;
          let y = this.scrollbarHeight,
            I;
          if (!this.hasDragged || g(e)) {
            a = h(a - n / 2);
            c = h(c + n / 2);
            if (!f(a) || !f(c))
              if (m) ((e = 0), (d = t(l.width, k.width)));
              else return;
            this.left = t(l.left, b.plotLeft + u + (q ? b.plotWidth : 0));
            var z =
              (this.size =
              I =
                t(l.len, (q ? b.plotHeight : b.plotWidth) - 2 * u));
            b = q ? y : I + 2 * u;
            e = t(e, l.toPixels(a, !0));
            d = t(d, l.toPixels(c, !0));
            (f(e) && Infinity !== Math.abs(e)) || ((e = 0), (d = b));
            a = l.toValue(e, !0);
            c = l.toValue(d, !0);
            var x = Math.abs(h(c - a));
            x < w
              ? this.grabbedLeft
                ? (e = l.toPixels(c - w - n, !0))
                : this.grabbedRight && (d = l.toPixels(a + w + n, !0))
              : g(r) &&
                h(x - n) > r &&
                (this.grabbedLeft
                  ? (e = l.toPixels(c - r - n, !0))
                  : this.grabbedRight && (d = l.toPixels(a + r + n, !0)));
            this.zoomedMax = v(Math.max(e, d), 0, z);
            this.zoomedMin = v(
              this.fixedWidth
                ? this.zoomedMax - this.fixedWidth
                : Math.min(e, d),
              0,
              z,
            );
            this.range = this.zoomedMax - this.zoomedMin;
            z = Math.round(this.zoomedMax);
            e = Math.round(this.zoomedMin);
            p &&
              (this.navigatorGroup.attr({ visibility: 'inherit' }),
              (m = m && !this.hasDragged ? 'animate' : 'attr'),
              this.drawMasks(e, z, q, m),
              this.drawOutline(e, z, q, m),
              this.navigatorOptions.handles.enabled &&
                (this.drawHandle(e, 0, q, m), this.drawHandle(z, 1, q, m)));
            this.scrollbar &&
              (q
                ? ((q = this.top - u),
                  (k =
                    this.left -
                    y +
                    (p || !k.opposite
                      ? 0
                      : (k.titleOffset || 0) + k.axisTitleMargin)),
                  (y = I + 2 * u))
                : ((q = this.top + (p ? this.height : -y)),
                  (k = this.left - u)),
              this.scrollbar.position(k, q, b, y),
              this.scrollbar.setRange(
                this.zoomedMin / (I || 1),
                this.zoomedMax / (I || 1),
              ));
            this.rendered = !0;
          }
        }
        addMouseEvents() {
          const a = this,
            c = a.chart,
            e = c.container;
          let d = [],
            f,
            g;
          a.mouseMoveHandler = f = function (b) {
            a.onMouseMove(b);
          };
          a.mouseUpHandler = g = function (b) {
            a.onMouseUp(b);
          };
          d = a.getPartsEvents('mousedown');
          d.push(
            m(c.renderTo, 'mousemove', f),
            m(e.ownerDocument, 'mouseup', g),
          );
          q &&
            (d.push(
              m(c.renderTo, 'touchmove', f),
              m(e.ownerDocument, 'touchend', g),
            ),
            d.concat(a.getPartsEvents('touchstart')));
          a.eventsToUnbind = d;
          a.series &&
            a.series[0] &&
            d.push(
              m(a.series[0].xAxis, 'foundExtremes', function () {
                c.navigator.modifyNavigatorAxisExtremes();
              }),
            );
        }
        getPartsEvents(a) {
          const b = this,
            e = [];
          ['shades', 'handles'].forEach(function (c) {
            b[c].forEach(function (d, f) {
              e.push(
                m(d.element, a, function (a) {
                  b[c + 'Mousedown'](a, f);
                }),
              );
            });
          });
          return e;
        }
        shadesMousedown(a, c) {
          a = this.chart.pointer.normalize(a);
          const b = this.chart,
            e = this.xAxis,
            d = this.zoomedMin,
            f = this.size,
            h = this.range;
          let n = this.left,
            k = a.chartX,
            p,
            m;
          b.inverted && ((k = a.chartY), (n = this.top));
          1 === c
            ? ((this.grabbedCenter = k),
              (this.fixedWidth = h),
              (this.dragOffset = k - d))
            : ((a = k - n - h / 2),
              0 === c
                ? (a = Math.max(0, a))
                : 2 === c &&
                  a + h >= f &&
                  ((a = f - h),
                  this.reversedExtremes
                    ? ((a -= h), (m = this.getUnionExtremes().dataMin))
                    : (p = this.getUnionExtremes().dataMax)),
              a !== d &&
                ((this.fixedWidth = h),
                (c = e.navigatorAxis.toFixedRange(a, a + h, m, p)),
                g(c.min) &&
                  b.xAxis[0].setExtremes(
                    Math.min(c.min, c.max),
                    Math.max(c.min, c.max),
                    !0,
                    null,
                    { trigger: 'navigator' },
                  )));
        }
        handlesMousedown(a, c) {
          this.chart.pointer.normalize(a);
          a = this.chart;
          const b = a.xAxis[0],
            e = this.reversedExtremes;
          0 === c
            ? ((this.grabbedLeft = !0),
              (this.otherHandlePos = this.zoomedMax),
              (this.fixedExtreme = e ? b.min : b.max))
            : ((this.grabbedRight = !0),
              (this.otherHandlePos = this.zoomedMin),
              (this.fixedExtreme = e ? b.max : b.min));
          a.fixedRange = null;
        }
        onMouseMove(a) {
          const b = this;
          var e = b.chart;
          const d = b.navigatorSize,
            f = b.range,
            g = b.dragOffset,
            h = e.inverted;
          let n = b.left;
          (a.touches && 0 === a.touches[0].pageX) ||
            ((a = e.pointer.normalize(a)),
            (e = a.chartX),
            h && ((n = b.top), (e = a.chartY)),
            b.grabbedLeft
              ? ((b.hasDragged = !0), b.render(0, 0, e - n, b.otherHandlePos))
              : b.grabbedRight
                ? ((b.hasDragged = !0), b.render(0, 0, b.otherHandlePos, e - n))
                : b.grabbedCenter &&
                  ((b.hasDragged = !0),
                  e < g ? (e = g) : e > d + g - f && (e = d + g - f),
                  b.render(0, 0, e - g, e - g + f)),
            b.hasDragged &&
              b.scrollbar &&
              t(b.scrollbar.options.liveRedraw, !r && !this.chart.boosted) &&
              ((a.DOMType = a.type),
              setTimeout(function () {
                b.onMouseUp(a);
              }, 0)));
        }
        onMouseUp(a) {
          var b = this.chart,
            e = this.xAxis,
            d = this.scrollbar;
          const h = a.DOMEvent || a,
            n = b.inverted,
            k = this.rendered && !this.hasDragged ? 'animate' : 'attr';
          let p, m;
          ((!this.hasDragged || (d && d.hasDragged)) &&
            'scrollbar' !== a.trigger) ||
            ((d = this.getUnionExtremes()),
            this.zoomedMin === this.otherHandlePos
              ? (p = this.fixedExtreme)
              : this.zoomedMax === this.otherHandlePos &&
                (m = this.fixedExtreme),
            this.zoomedMax === this.size &&
              (m = this.reversedExtremes ? d.dataMin : d.dataMax),
            0 === this.zoomedMin &&
              (p = this.reversedExtremes ? d.dataMax : d.dataMin),
            (e = e.navigatorAxis.toFixedRange(
              this.zoomedMin,
              this.zoomedMax,
              p,
              m,
            )),
            g(e.min) &&
              b.xAxis[0].setExtremes(
                Math.min(e.min, e.max),
                Math.max(e.min, e.max),
                !0,
                this.hasDragged ? !1 : null,
                {
                  trigger: 'navigator',
                  triggerOp: 'navigator-drag',
                  DOMEvent: h,
                },
              ));
          'mousemove' !== a.DOMType &&
            'touchmove' !== a.DOMType &&
            (this.grabbedLeft =
              this.grabbedRight =
              this.grabbedCenter =
              this.fixedWidth =
              this.fixedExtreme =
              this.otherHandlePos =
              this.hasDragged =
              this.dragOffset =
                null);
          this.navigatorEnabled &&
            f(this.zoomedMin) &&
            f(this.zoomedMax) &&
            ((b = Math.round(this.zoomedMin)),
            (a = Math.round(this.zoomedMax)),
            this.shades && this.drawMasks(b, a, n, k),
            this.outline && this.drawOutline(b, a, n, k),
            this.navigatorOptions.handles.enabled &&
              Object.keys(this.handles).length === this.handles.length &&
              (this.drawHandle(b, 0, n, k), this.drawHandle(a, 1, n, k)));
        }
        removeEvents() {
          this.eventsToUnbind &&
            (this.eventsToUnbind.forEach(function (a) {
              a();
            }),
            (this.eventsToUnbind = void 0));
          this.removeBaseSeriesEvents();
        }
        removeBaseSeriesEvents() {
          const a = this.baseSeries || [];
          this.navigatorEnabled &&
            a[0] &&
            (!1 !== this.navigatorOptions.adaptToUpdatedData &&
              a.forEach(function (a) {
                n(a, 'updatedData', this.updatedDataHandler);
              }, this),
            a[0].xAxis &&
              n(a[0].xAxis, 'foundExtremes', this.modifyBaseAxisExtremes));
        }
        init(b) {
          var c = b.options,
            e = c.navigator || {},
            d = e.enabled,
            g = c.scrollbar || {},
            h = g.enabled;
          c = (d && e.height) || 0;
          var n = (h && g.height) || 0;
          const k = (g.buttonsEnabled && n) || 0;
          this.handles = [];
          this.shades = [];
          this.chart = b;
          this.setBaseSeries();
          this.height = c;
          this.scrollbarHeight = n;
          this.scrollButtonSize = k;
          this.scrollbarEnabled = h;
          this.navigatorEnabled = d;
          this.navigatorOptions = e;
          this.scrollbarOptions = g;
          this.opposite = t(e.opposite, !(d || !b.inverted));
          const q = this;
          d = q.baseSeries;
          g = b.xAxis.length;
          h = b.yAxis.length;
          n = (d && d[0] && d[0].xAxis) || b.xAxis[0] || { options: {} };
          b.isDirtyBox = !0;
          q.navigatorEnabled
            ? ((q.xAxis = new a(
                b,
                p(
                  { breaks: n.options.breaks, ordinal: n.options.ordinal },
                  e.xAxis,
                  {
                    id: 'navigator-x-axis',
                    yAxis: 'navigator-y-axis',
                    type: 'datetime',
                    index: g,
                    isInternal: !0,
                    offset: 0,
                    keepOrdinalPadding: !0,
                    startOnTick: !1,
                    endOnTick: !1,
                    minPadding: 0,
                    maxPadding: 0,
                    zoomEnabled: !1,
                  },
                  b.inverted
                    ? { offsets: [k, 0, -k, 0], width: c }
                    : { offsets: [0, -k, 0, k], height: c },
                ),
                'xAxis',
              )),
              (q.yAxis = new a(
                b,
                p(
                  e.yAxis,
                  {
                    id: 'navigator-y-axis',
                    alignTicks: !1,
                    offset: 0,
                    index: h,
                    isInternal: !0,
                    reversed: t(
                      e.yAxis && e.yAxis.reversed,
                      b.yAxis[0] && b.yAxis[0].reversed,
                      !1,
                    ),
                    zoomEnabled: !1,
                  },
                  b.inverted ? { width: c } : { height: c },
                ),
                'yAxis',
              )),
              d || e.series.data
                ? q.updateNavigatorSeries(!1)
                : 0 === b.series.length &&
                  (q.unbindRedraw = m(b, 'beforeRedraw', function () {
                    0 < b.series.length &&
                      !q.series &&
                      (q.setBaseSeries(), q.unbindRedraw());
                  })),
              (q.reversedExtremes =
                (b.inverted && !q.xAxis.reversed) ||
                (!b.inverted && q.xAxis.reversed)),
              q.renderElements(),
              q.addMouseEvents())
            : ((q.xAxis = {
                chart: b,
                navigatorAxis: { fake: !0 },
                translate: function (a, c) {
                  var e = b.xAxis[0];
                  const d = e.getExtremes(),
                    f = e.len - 2 * k,
                    g = x('min', e.options.min, d.dataMin);
                  e = x('max', e.options.max, d.dataMax) - g;
                  return c ? (a * e) / f + g : (f * (a - g)) / e;
                },
                toPixels: function (a) {
                  return this.translate(a);
                },
                toValue: function (a) {
                  return this.translate(a, !0);
                },
              }),
              (q.xAxis.navigatorAxis.axis = q.xAxis),
              (q.xAxis.navigatorAxis.toFixedRange =
                H.prototype.toFixedRange.bind(q.xAxis.navigatorAxis)));
          b.options.scrollbar.enabled &&
            ((e = p(b.options.scrollbar, { vertical: b.inverted })),
            !f(e.margin) &&
              q.navigatorEnabled &&
              (e.margin = b.inverted ? -3 : 3),
            (b.scrollbar = q.scrollbar = new z(b.renderer, e, b)),
            m(q.scrollbar, 'changed', function (a) {
              var b = q.size;
              const c = b * this.to;
              b *= this.from;
              q.hasDragged = q.scrollbar.hasDragged;
              q.render(0, 0, b, c);
              this.shouldUpdateExtremes(a.DOMType) &&
                setTimeout(function () {
                  q.onMouseUp(a);
                });
            }));
          q.addBaseSeriesEvents();
          q.addChartEvents();
        }
        getUnionExtremes(a) {
          const b = this.chart.xAxis[0],
            e = this.xAxis,
            d = e.options,
            f = b.options;
          let g;
          (a && null === b.dataMin) ||
            (g = {
              dataMin: t(
                d && d.min,
                x('min', f.min, b.dataMin, e.dataMin, e.min),
              ),
              dataMax: t(
                d && d.max,
                x('max', f.max, b.dataMax, e.dataMax, e.max),
              ),
            });
          return g;
        }
        setBaseSeries(a, c) {
          const b = this.chart,
            e = (this.baseSeries = []);
          a =
            a ||
            (b.options && b.options.navigator.baseSeries) ||
            (b.series.length
              ? K(b.series, (a) => !a.options.isInternal).index
              : 0);
          (b.series || []).forEach((b, c) => {
            b.options.isInternal ||
              (!b.options.showInNavigator &&
                ((c !== a && b.options.id !== a) ||
                  !1 === b.options.showInNavigator)) ||
              e.push(b);
          });
          this.xAxis &&
            !this.xAxis.navigatorAxis.fake &&
            this.updateNavigatorSeries(!0, c);
        }
        updateNavigatorSeries(a, c) {
          const b = this,
            e = b.chart,
            d = b.baseSeries,
            f = {
              enableMouseTracking: !1,
              index: null,
              linkedTo: null,
              group: 'nav',
              padXAxis: !1,
              xAxis: 'navigator-x-axis',
              yAxis: 'navigator-y-axis',
              showInLegend: !1,
              stacking: void 0,
              isInternal: !0,
              states: { inactive: { opacity: 1 } },
            },
            g = (b.series = (b.series || []).filter((a) => {
              const c = a.baseSeries;
              return 0 > d.indexOf(c)
                ? (c &&
                    (n(c, 'updatedData', b.updatedDataHandler),
                    delete c.navigatorSeries),
                  a.chart && a.destroy(),
                  !1)
                : !0;
            }));
          let h,
            k,
            m = b.navigatorOptions.series,
            q;
          d &&
            d.length &&
            d.forEach((a) => {
              const l = a.navigatorSeries;
              var n = y(
                { color: a.color, visible: a.visible },
                L(m) ? u.navigator.series : m,
              );
              (l && !1 === b.navigatorOptions.adaptToUpdatedData) ||
                ((f.name = 'Navigator ' + d.length),
                (h = a.options || {}),
                (q = h.navigatorOptions || {}),
                (n.dataLabels = w(n.dataLabels)),
                (k = p(h, f, n, q)),
                (k.pointRange = t(
                  n.pointRange,
                  q.pointRange,
                  u.plotOptions[k.type || 'line'].pointRange,
                )),
                (n = q.data || n.data),
                (b.hasNavigatorData = b.hasNavigatorData || !!n),
                (k.data = n || (h.data && h.data.slice(0))),
                l && l.options
                  ? l.update(k, c)
                  : ((a.navigatorSeries = e.initSeries(k)),
                    (a.navigatorSeries.baseSeries = a),
                    g.push(a.navigatorSeries)));
            });
          if ((m.data && (!d || !d.length)) || L(m))
            ((b.hasNavigatorData = !1),
              (m = w(m)),
              m.forEach((a, c) => {
                f.name = 'Navigator ' + (g.length + 1);
                k = p(
                  u.navigator.series,
                  {
                    color:
                      (e.series[c] &&
                        !e.series[c].options.isInternal &&
                        e.series[c].color) ||
                      e.options.colors[c] ||
                      e.options.colors[0],
                  },
                  f,
                  a,
                );
                k.data = a.data;
                k.data && ((b.hasNavigatorData = !0), g.push(e.initSeries(k)));
              }));
          a && this.addBaseSeriesEvents();
        }
        addBaseSeriesEvents() {
          const a = this,
            c = a.baseSeries || [];
          c[0] &&
            c[0].xAxis &&
            c[0].eventsToUnbind.push(
              m(c[0].xAxis, 'foundExtremes', this.modifyBaseAxisExtremes),
            );
          c.forEach((b) => {
            b.eventsToUnbind.push(
              m(b, 'show', function () {
                this.navigatorSeries && this.navigatorSeries.setVisible(!0, !1);
              }),
            );
            b.eventsToUnbind.push(
              m(b, 'hide', function () {
                this.navigatorSeries && this.navigatorSeries.setVisible(!1, !1);
              }),
            );
            !1 !== this.navigatorOptions.adaptToUpdatedData &&
              b.xAxis &&
              b.eventsToUnbind.push(
                m(b, 'updatedData', this.updatedDataHandler),
              );
            b.eventsToUnbind.push(
              m(b, 'remove', function () {
                this.navigatorSeries &&
                  (k(a.series, this.navigatorSeries),
                  g(this.navigatorSeries.options) &&
                    this.navigatorSeries.remove(!1),
                  delete this.navigatorSeries);
              }),
            );
          });
        }
        getBaseSeriesMin(a) {
          return this.baseSeries.reduce(function (a, b) {
            return Math.min(a, b.xData && b.xData.length ? b.xData[0] : a);
          }, a);
        }
        modifyNavigatorAxisExtremes() {
          const a = this.xAxis;
          if ('undefined' !== typeof a.getExtremes) {
            const b = this.getUnionExtremes(!0);
            !b ||
              (b.dataMin === a.min && b.dataMax === a.max) ||
              ((a.min = b.dataMin), (a.max = b.dataMax));
          }
        }
        modifyBaseAxisExtremes() {
          const a = this.chart.navigator;
          var c = this.getExtremes();
          const e = c.dataMin,
            d = c.dataMax;
          c = c.max - c.min;
          const g = a.stickToMin,
            h = a.stickToMax,
            n = t(this.options.overscroll, 0),
            k = a.series && a.series[0],
            p = !!this.setExtremes;
          let m, q;
          (this.eventArgs &&
            'rangeSelectorButton' === this.eventArgs.trigger) ||
            (g && ((q = e), (m = q + c)),
            h &&
              ((m = d + n),
              g ||
                (q = Math.max(
                  e,
                  m - c,
                  a.getBaseSeriesMin(
                    k && k.xData ? k.xData[0] : -Number.MAX_VALUE,
                  ),
                ))),
            p &&
              (g || h) &&
              f(q) &&
              ((this.min = this.userMin = q), (this.max = this.userMax = m)));
          a.stickToMin = a.stickToMax = null;
        }
        updatedDataHandler() {
          const a = this.chart.navigator,
            c = this.navigatorSeries;
          a.stickToMax = t(
            this.chart.options.navigator &&
              this.chart.options.navigator.stickToMax,
            a.reversedExtremes
              ? 0 === Math.round(a.zoomedMin)
              : Math.round(a.zoomedMax) >= Math.round(a.size),
          );
          a.stickToMin = a.shouldStickToMin(this, a);
          c &&
            !a.hasNavigatorData &&
            ((c.options.pointStart = this.xData[0]),
            c.setData(this.options.data, !1, null, !1));
        }
        shouldStickToMin(a, c) {
          c = c.getBaseSeriesMin(a.xData[0]);
          var b = a.xAxis;
          a = b.max;
          const e = b.min;
          b = b.options.range;
          return f(a) && f(e) ? (b && 0 < a - c ? a - c < b : e <= c) : !1;
        }
        addChartEvents() {
          this.eventsToUnbind || (this.eventsToUnbind = []);
          this.eventsToUnbind.push(
            m(this.chart, 'redraw', function () {
              const a = this.navigator,
                c =
                  a &&
                  ((a.baseSeries && a.baseSeries[0] && a.baseSeries[0].xAxis) ||
                    this.xAxis[0]);
              c && a.render(c.min, c.max);
            }),
            m(this.chart, 'getMargins', function () {
              let a = this.navigator,
                c = a.opposite ? 'plotTop' : 'marginBottom';
              this.inverted && (c = a.opposite ? 'marginRight' : 'plotLeft');
              this[c] =
                (this[c] || 0) +
                (a.navigatorEnabled || !this.inverted
                  ? a.height + a.scrollbarHeight
                  : 0) +
                a.navigatorOptions.margin;
            }),
          );
        }
        destroy() {
          this.removeEvents();
          this.xAxis &&
            (k(this.chart.xAxis, this.xAxis), k(this.chart.axes, this.xAxis));
          this.yAxis &&
            (k(this.chart.yAxis, this.yAxis), k(this.chart.axes, this.yAxis));
          (this.series || []).forEach((a) => {
            a.destroy && a.destroy();
          });
          'series xAxis yAxis shades outline scrollbarTrack scrollbarRifles scrollbarGroup scrollbar navigatorGroup rendered'
            .split(' ')
            .forEach((a) => {
              this[a] && this[a].destroy && this[a].destroy();
              this[a] = null;
            });
          [this.handles].forEach((a) => {
            d(a);
          });
        }
      }
      return e;
    },
  );
  M(a, 'Stock/RangeSelector/RangeSelectorDefaults.js', [], function () {
    return {
      lang: {
        rangeSelectorZoom: 'Zoom',
        rangeSelectorFrom: '',
        rangeSelectorTo: '\u2192',
      },
      rangeSelector: {
        allButtonsEnabled: !1,
        buttons: void 0,
        buttonSpacing: 5,
        dropdown: 'responsive',
        enabled: void 0,
        verticalAlign: 'top',
        buttonTheme: { width: 28, height: 18, padding: 2, zIndex: 7 },
        floating: !1,
        x: 0,
        y: 0,
        height: void 0,
        inputBoxBorderColor: 'none',
        inputBoxHeight: 17,
        inputBoxWidth: void 0,
        inputDateFormat: '%e %b %Y',
        inputDateParser: void 0,
        inputEditDateFormat: '%Y-%m-%d',
        inputEnabled: !0,
        inputPosition: { align: 'right', x: 0, y: 0 },
        inputSpacing: 5,
        selected: void 0,
        buttonPosition: { align: 'left', x: 0, y: 0 },
        inputStyle: { color: '#334eff', cursor: 'pointer', fontSize: '0.8em' },
        labelStyle: { color: '#666666', fontSize: '0.8em' },
      },
    };
  });
  M(
    a,
    'Stock/RangeSelector/RangeSelectorComposition.js',
    [
      a['Core/Defaults.js'],
      a['Stock/RangeSelector/RangeSelectorDefaults.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G) {
      function x() {
        const a = this.range,
          d = a.type,
          e = this.max,
          b = this.chart.time,
          c = function (a, c) {
            const e = 'year' === d ? 'FullYear' : 'Month',
              f = new b.Date(a),
              g = b.get(e, f);
            b.set(e, f, g + c);
            g === b.get(e, f) && b.set('Date', f, 0);
            return f.getTime() - a;
          };
        let f, g;
        y(a)
          ? ((f = e - a), (g = a))
          : a &&
            ((f = e + c(e, -(a.count || 1))),
            this.chart && (this.chart.fixedRange = e - f));
        const h = L(this.dataMin, Number.MIN_VALUE);
        y(f) || (f = h);
        f <= h &&
          ((f = h),
          'undefined' === typeof g && (g = c(f, a.count)),
          (this.newMax = Math.min(f + g, L(this.dataMax, Number.MAX_VALUE))));
        y(e) ? !y(a) && a && a._offsetMin && (f += a._offsetMin) : (f = void 0);
        return f;
      }
      function C() {
        this.options.rangeSelector &&
          this.options.rangeSelector.enabled &&
          (this.rangeSelector = new t(this));
      }
      function z() {
        var a = this.axes;
        const d = this.rangeSelector;
        d &&
          (y(d.deferredYTDClick) &&
            (d.clickButton(d.deferredYTDClick), delete d.deferredYTDClick),
          a.forEach((a) => {
            a.updateNames();
            a.setScale();
          }),
          this.getAxisMargins(),
          d.render(),
          (a = d.options.verticalAlign),
          d.options.floating ||
            ('bottom' === a
              ? (this.extraBottomMargin = !0)
              : 'middle' !== a && (this.extraTopMargin = !0)));
      }
      function D(a) {
        let d, e, b, c;
        const g = a.rangeSelector,
          n = () => {
            g &&
              ((d = a.xAxis[0].getExtremes()),
              (e = a.legend),
              (c = g && g.options.verticalAlign),
              y(d.min) && g.render(d.min, d.max),
              e.display &&
                'top' === c &&
                c === e.options.verticalAlign &&
                ((b = K(a.spacingBox)),
                (b.y =
                  'vertical' === e.options.layout
                    ? a.plotTop
                    : b.y + g.getHeight()),
                (e.group.placed = !1),
                e.align(b)));
          };
        g &&
          (k(f, (b) => b[0] === a) ||
            f.push([
              a,
              [
                h(a.xAxis[0], 'afterSetExtremes', function (a) {
                  g && g.render(a.min, a.max);
                }),
                h(a, 'redraw', n),
              ],
            ]),
          n());
      }
      function B() {
        for (let a = 0, d = f.length; a < d; ++a) {
          const e = f[a];
          if (e[0] === this) {
            e[1].forEach((a) => a());
            f.splice(a, 1);
            break;
          }
        }
      }
      function u() {
        var a = this.rangeSelector;
        a &&
          ((a = a.getHeight()),
          this.extraTopMargin && (this.plotTop += a),
          this.extraBottomMargin && (this.marginBottom += a));
      }
      function q() {
        var a = this.rangeSelector;
        a &&
          !a.options.floating &&
          (a.render(),
          (a = a.options.verticalAlign),
          'bottom' === a
            ? (this.extraBottomMargin = !0)
            : 'middle' !== a && (this.extraTopMargin = !0));
      }
      function r(a) {
        var d = a.options.rangeSelector;
        a = this.extraBottomMargin;
        const e = this.extraTopMargin;
        let b = this.rangeSelector;
        d &&
          d.enabled &&
          !g(b) &&
          this.options.rangeSelector &&
          ((this.options.rangeSelector.enabled = !0),
          (this.rangeSelector = b = new t(this)));
        this.extraTopMargin = this.extraBottomMargin = !1;
        b &&
          (D(this),
          (d =
            (d && d.verticalAlign) || (b.options && b.options.verticalAlign)),
          b.options.floating ||
            ('bottom' === d
              ? (this.extraBottomMargin = !0)
              : 'middle' !== d && (this.extraTopMargin = !0)),
          this.extraBottomMargin !== a || this.extraTopMargin !== e) &&
          (this.isDirtyBox = !0);
      }
      const { defaultOptions: m, setOptions: v } = a,
        {
          addEvent: h,
          defined: g,
          extend: d,
          find: k,
          isNumber: y,
          merge: K,
          pick: L,
        } = G,
        f = [],
        p = [];
      let t;
      return {
        compose: function (a, f, e) {
          t = e;
          G.pushUnique(p, a) && (a.prototype.minFromRange = x);
          G.pushUnique(p, f) &&
            (h(f, 'afterGetContainer', C),
            h(f, 'beforeRender', z),
            h(f, 'destroy', B),
            h(f, 'getMargins', u),
            h(f, 'render', q),
            h(f, 'update', r),
            f.prototype.callbacks.push(D));
          G.pushUnique(p, v) &&
            (d(m, { rangeSelector: A.rangeSelector }), d(m.lang, A.lang));
        },
      };
    },
  );
  M(
    a,
    'Stock/RangeSelector/RangeSelector.js',
    [
      a['Core/Axis/Axis.js'],
      a['Core/Defaults.js'],
      a['Core/Globals.js'],
      a['Stock/RangeSelector/RangeSelectorComposition.js'],
      a['Core/Renderer/SVG/SVGElement.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z) {
      function x(a) {
        if (-1 !== a.indexOf('%L')) return 'text';
        const e = 'aAdewbBmoyY'
            .split('')
            .some((b) => -1 !== a.indexOf('%' + b)),
          b = 'HkIlMS'.split('').some((b) => -1 !== a.indexOf('%' + b));
        return e && b ? 'datetime-local' : e ? 'date' : b ? 'time' : 'text';
      }
      const { defaultOptions: B } = A,
        {
          addEvent: u,
          createElement: q,
          css: r,
          defined: m,
          destroyObjectProperties: v,
          discardElement: h,
          extend: g,
          fireEvent: d,
          isNumber: k,
          merge: y,
          objectEach: K,
          pad: L,
          pick: f,
          pInt: p,
          splat: t,
        } = z;
      class n {
        static compose(a, e) {
          H.compose(a, e, n);
        }
        constructor(a) {
          this.buttons = void 0;
          this.buttonOptions = n.prototype.defaultButtons;
          this.initialButtonGroupWidth = 0;
          this.options = void 0;
          this.chart = a;
          this.init(a);
        }
        clickButton(g, e) {
          const b = this.chart,
            c = this.buttonOptions[g],
            l = b.xAxis[0];
          var h = (b.scroller && b.scroller.getUnionExtremes()) || l || {},
            n = c.type;
          const p = c.dataGrouping;
          let q = h.dataMin,
            w = h.dataMax,
            r,
            v = l && Math.round(Math.min(l.max, f(w, l.max))),
            y;
          h = c._range;
          let E,
            z,
            x,
            B = !0;
          if (null !== q && null !== w) {
            b.fixedRange = h;
            this.setSelected(g);
            p &&
              ((this.forcedDataGrouping = !0),
              a.prototype.setDataGrouping.call(
                l || { chart: this.chart },
                p,
                !1,
              ),
              (this.frozenStates = c.preserveDataGrouping));
            if ('month' === n || 'year' === n)
              l
                ? ((n = { range: c, max: v, chart: b, dataMin: q, dataMax: w }),
                  (r = l.minFromRange.call(n)),
                  k(n.newMax) && (v = n.newMax),
                  (B = !1))
                : (h = c);
            else if (h)
              ((r = Math.max(v - h, q)), (v = Math.min(r + h, w)), (B = !1));
            else if ('ytd' === n)
              if (l) {
                if ('undefined' === typeof w || 'undefined' === typeof q)
                  ((q = Number.MAX_VALUE),
                    (w = Number.MIN_VALUE),
                    b.series.forEach((a) => {
                      if ((a = a.xData))
                        ((q = Math.min(a[0], q)),
                          (w = Math.max(a[a.length - 1], w)));
                    }),
                    (e = !1));
                n = this.getYTDExtremes(w, q, b.time.useUTC);
                r = E = n.min;
                v = n.max;
              } else {
                this.deferredYTDClick = g;
                return;
              }
            else
              'all' === n &&
                l &&
                (b.navigator &&
                  b.navigator.baseSeries[0] &&
                  (b.navigator.baseSeries[0].xAxis.options.range = void 0),
                (r = q),
                (v = w));
            B && c._offsetMin && m(r) && (r += c._offsetMin);
            c._offsetMax && m(v) && (v += c._offsetMax);
            this.dropdown && (this.dropdown.selectedIndex = g + 1);
            l
              ? l.setExtremes(r, v, f(e, !0), void 0, {
                  trigger: 'rangeSelectorButton',
                  rangeSelectorButton: c,
                })
              : ((y = t(b.options.xAxis)[0]),
                (x = y.range),
                (y.range = h),
                (z = y.min),
                (y.min = E),
                u(b, 'load', function () {
                  y.range = x;
                  y.min = z;
                }));
            d(this, 'afterBtnClick');
          }
        }
        setSelected(a) {
          this.selected = this.options.selected = a;
        }
        init(a) {
          const e = this,
            b = a.options.rangeSelector,
            c = b.buttons || e.defaultButtons.slice(),
            f = b.selected,
            g = function () {
              const a = e.minInput,
                b = e.maxInput;
              a && a.blur && d(a, 'blur');
              b && b.blur && d(b, 'blur');
            };
          e.chart = a;
          e.options = b;
          e.buttons = [];
          e.buttonOptions = c;
          this.eventsToUnbind = [];
          this.eventsToUnbind.push(u(a.container, 'mousedown', g));
          this.eventsToUnbind.push(u(a, 'resize', g));
          c.forEach(e.computeButtonRange);
          'undefined' !== typeof f && c[f] && this.clickButton(f, !1);
          this.eventsToUnbind.push(
            u(a, 'load', function () {
              a.xAxis &&
                a.xAxis[0] &&
                u(a.xAxis[0], 'setExtremes', function (b) {
                  this.max - this.min !== a.fixedRange &&
                    'rangeSelectorButton' !== b.trigger &&
                    'updatedData' !== b.trigger &&
                    e.forcedDataGrouping &&
                    !e.frozenStates &&
                    this.setDataGrouping(!1, !1);
                });
            }),
          );
        }
        updateButtonStates() {
          const a = this;
          var e = this.chart;
          const b = this.dropdown,
            c = e.xAxis[0],
            d = Math.round(c.max - c.min),
            f = !c.hasVisibleSeries,
            g = (e.scroller && e.scroller.getUnionExtremes()) || c,
            h = g.dataMin,
            n = g.dataMax;
          e = a.getYTDExtremes(n, h, e.time.useUTC);
          const p = e.min,
            m = e.max,
            q = a.selected,
            t = a.options.allButtonsEnabled,
            r = a.buttons;
          let v = k(q);
          a.buttonOptions.forEach((e, g) => {
            var l = e._range,
              k = e.type,
              w = e.count || 1;
            const u = r[g],
              y = e._offsetMax - e._offsetMin,
              E = g === q,
              I = l > n - h,
              F = l < c.minRange;
            e = 0;
            let z = !1,
              x = !1;
            l = l === d;
            ('month' === k || 'year' === k) &&
            d + 36e5 >= 864e5 * { month: 28, year: 365 }[k] * w - y &&
            d - 36e5 <= 864e5 * { month: 31, year: 366 }[k] * w + y
              ? (l = !0)
              : 'ytd' === k
                ? ((l = m - p + y === d), (z = !E))
                : 'all' === k &&
                  ((l = c.max - c.min >= n - h), (x = !E && v && l));
            k = !t && (I || F || x || f);
            w = (E && l) || (l && !v && !z) || (E && a.frozenStates);
            k ? (e = 3) : w && ((v = !0), (e = 2));
            u.state !== e &&
              (u.setState(e),
              b &&
                ((b.options[g + 1].disabled = k),
                2 === e && (b.selectedIndex = g + 1)),
              0 === e && q === g && a.setSelected());
          });
        }
        computeButtonRange(a) {
          const e = a.type,
            b = a.count || 1,
            c = {
              millisecond: 1,
              second: 1e3,
              minute: 6e4,
              hour: 36e5,
              day: 864e5,
              week: 6048e5,
            };
          if (c[e]) a._range = c[e] * b;
          else if ('month' === e || 'year' === e)
            a._range = 864e5 * { month: 30, year: 365 }[e] * b;
          a._offsetMin = f(a.offsetMin, 0);
          a._offsetMax = f(a.offsetMax, 0);
          a._range += a._offsetMax - a._offsetMin;
        }
        getInputValue(a) {
          a = 'min' === a ? this.minInput : this.maxInput;
          const e = this.chart.options.rangeSelector,
            b = this.chart.time;
          return a
            ? (
                ('text' === a.type && e.inputDateParser) ||
                this.defaultInputDateParser
              )(a.value, b.useUTC, b)
            : 0;
        }
        setInputValue(a, e) {
          const b = this.options,
            c = this.chart.time,
            d = 'min' === a ? this.minInput : this.maxInput;
          a = 'min' === a ? this.minDateBox : this.maxDateBox;
          if (d) {
            var f = d.getAttribute('data-hc-time');
            f = m(f) ? Number(f) : void 0;
            m(e) &&
              (m(f) && d.setAttribute('data-hc-time-previous', f),
              d.setAttribute('data-hc-time', e),
              (f = e));
            d.value = c.dateFormat(
              this.inputTypeFormats[d.type] || b.inputEditDateFormat,
              f,
            );
            a && a.attr({ text: c.dateFormat(b.inputDateFormat, f) });
          }
        }
        setInputExtremes(a, e, b) {
          if ((a = 'min' === a ? this.minInput : this.maxInput)) {
            const c = this.inputTypeFormats[a.type],
              d = this.chart.time;
            c &&
              ((e = d.dateFormat(c, e)),
              a.min !== e && (a.min = e),
              (b = d.dateFormat(c, b)),
              a.max !== b && (a.max = b));
          }
        }
        showInput(a) {
          const e = 'min' === a ? this.minDateBox : this.maxDateBox;
          if (
            (a = 'min' === a ? this.minInput : this.maxInput) &&
            e &&
            this.inputGroup
          ) {
            const b = 'text' === a.type,
              { translateX: c, translateY: d } = this.inputGroup,
              { inputBoxWidth: f } = this.options;
            r(a, {
              width: b ? e.width + (f ? -2 : 20) + 'px' : 'auto',
              height: e.height - 2 + 'px',
              border: '2px solid silver',
            });
            b && f
              ? r(a, { left: c + e.x + 'px', top: d + 'px' })
              : r(a, {
                  left:
                    Math.min(
                      Math.round(e.x + c - (a.offsetWidth - e.width) / 2),
                      this.chart.chartWidth - a.offsetWidth,
                    ) + 'px',
                  top: d - (a.offsetHeight - e.height) / 2 + 'px',
                });
          }
        }
        hideInput(a) {
          (a = 'min' === a ? this.minInput : this.maxInput) &&
            r(a, { top: '-9999em', border: 0, width: '1px', height: '1px' });
        }
        defaultInputDateParser(a, e, b) {
          var c = a.split('/').join('-').split(' ').join('T');
          -1 === c.indexOf('T') && (c += 'T00:00');
          if (e) c += 'Z';
          else {
            var d;
            if ((d = G.isSafari))
              ((d = c),
                (d = !(
                  6 < d.length &&
                  (d.lastIndexOf('-') === d.length - 6 ||
                    d.lastIndexOf('+') === d.length - 6)
                )));
            d &&
              ((d = new Date(c).getTimezoneOffset() / 60),
              (c += 0 >= d ? `+${L(-d)}:00` : `-${L(d)}:00`));
          }
          c = Date.parse(c);
          k(c) ||
            ((a = a.split('-')), (c = Date.UTC(p(a[0]), p(a[1]) - 1, p(a[2]))));
          b && e && k(c) && (c += b.getTimezoneOffset(c));
          return c;
        }
        drawInput(a) {
          function e() {
            const { maxInput: c, minInput: e } = f,
              d = b.xAxis[0];
            var g = (b.scroller && b.scroller.getUnionExtremes()) || d;
            const l = g.dataMin;
            g = g.dataMax;
            let h = f.getInputValue(a);
            h !== Number(w.getAttribute('data-hc-time-previous')) &&
              k(h) &&
              (w.setAttribute('data-hc-time-previous', h),
              m && c && k(l)
                ? h > Number(c.getAttribute('data-hc-time'))
                  ? (h = void 0)
                  : h < l && (h = l)
                : e &&
                  k(g) &&
                  (h < Number(e.getAttribute('data-hc-time'))
                    ? (h = void 0)
                    : h > g && (h = g)),
              'undefined' !== typeof h &&
                d.setExtremes(m ? h : d.min, m ? d.max : h, void 0, void 0, {
                  trigger: 'rangeSelectorInput',
                }));
          }
          const { chart: b, div: c, inputGroup: d } = this,
            f = this,
            h = b.renderer.style || {};
          var n = b.renderer;
          const p = b.options.rangeSelector,
            m = 'min' === a;
          var t = B.lang[m ? 'rangeSelectorFrom' : 'rangeSelectorTo'] || '';
          t = n
            .label(t, 0)
            .addClass('highcharts-range-label')
            .attr({ padding: t ? 2 : 0, height: t ? p.inputBoxHeight : 0 })
            .add(d);
          n = n
            .label('', 0)
            .addClass('highcharts-range-input')
            .attr({
              padding: 2,
              width: p.inputBoxWidth,
              height: p.inputBoxHeight,
              'text-align': 'center',
            })
            .on('click', function () {
              f.showInput(a);
              f[a + 'Input'].focus();
            });
          b.styledMode ||
            n.attr({ stroke: p.inputBoxBorderColor, 'stroke-width': 1 });
          n.add(d);
          const w = q(
            'input',
            { name: a, className: 'highcharts-range-selector' },
            void 0,
            c,
          );
          w.setAttribute('type', x(p.inputDateFormat || '%e %b %Y'));
          b.styledMode ||
            (t.css(y(h, p.labelStyle)),
            n.css(y({ color: '#333333' }, h, p.inputStyle)),
            r(
              w,
              g(
                {
                  position: 'absolute',
                  border: 0,
                  boxShadow: '0 0 15px rgba(0,0,0,0.3)',
                  width: '1px',
                  height: '1px',
                  padding: 0,
                  textAlign: 'center',
                  fontSize: h.fontSize,
                  fontFamily: h.fontFamily,
                  top: '-9999em',
                },
                p.inputStyle,
              ),
            ));
          w.onfocus = () => {
            f.showInput(a);
          };
          w.onblur = () => {
            w === G.doc.activeElement && e();
            f.hideInput(a);
            f.setInputValue(a);
            w.blur();
          };
          let v = !1;
          w.onchange = () => {
            v || (e(), f.hideInput(a), w.blur());
          };
          w.onkeypress = (a) => {
            13 === a.keyCode && e();
          };
          w.onkeydown = (a) => {
            v = !0;
            (38 !== a.keyCode && 40 !== a.keyCode) || e();
          };
          w.onkeyup = () => {
            v = !1;
          };
          return { dateBox: n, input: w, label: t };
        }
        getPosition() {
          var a = this.chart;
          const e = a.options.rangeSelector;
          a = 'top' === e.verticalAlign ? a.plotTop - a.axisOffset[0] : 0;
          return {
            buttonTop: a + e.buttonPosition.y,
            inputTop: a + e.inputPosition.y - 10,
          };
        }
        getYTDExtremes(a, e, b) {
          const c = this.chart.time;
          var d = new c.Date(a);
          const f = c.get('FullYear', d);
          b = b ? c.Date.UTC(f, 0, 1) : +new c.Date(f, 0, 1);
          e = Math.max(e, b);
          d = d.getTime();
          return { max: Math.min(a || d, d), min: e };
        }
        render(a, e) {
          var b = this.chart,
            c = b.renderer;
          const d = b.container;
          var g = b.options;
          const h = g.rangeSelector,
            k = f(g.chart.style && g.chart.style.zIndex, 0) + 1;
          g = h.inputEnabled;
          if (!1 !== h.enabled) {
            this.rendered ||
              ((this.group = c
                .g('range-selector-group')
                .attr({ zIndex: 7 })
                .add()),
              (this.div = q('div', void 0, {
                position: 'relative',
                height: 0,
                zIndex: k,
              })),
              this.buttonOptions.length && this.renderButtons(),
              d.parentNode && d.parentNode.insertBefore(this.div, d),
              g &&
                ((this.inputGroup = c.g('input-group').add(this.group)),
                (c = this.drawInput('min')),
                (this.minDateBox = c.dateBox),
                (this.minLabel = c.label),
                (this.minInput = c.input),
                (c = this.drawInput('max')),
                (this.maxDateBox = c.dateBox),
                (this.maxLabel = c.label),
                (this.maxInput = c.input)));
            if (
              g &&
              (this.setInputValue('min', a),
              this.setInputValue('max', e),
              (a =
                (b.scroller && b.scroller.getUnionExtremes()) ||
                b.xAxis[0] ||
                {}),
              m(a.dataMin) &&
                m(a.dataMax) &&
                ((b = b.xAxis[0].minRange || 0),
                this.setInputExtremes(
                  'min',
                  a.dataMin,
                  Math.min(a.dataMax, this.getInputValue('max')) - b,
                ),
                this.setInputExtremes(
                  'max',
                  Math.max(a.dataMin, this.getInputValue('min')) + b,
                  a.dataMax,
                )),
              this.inputGroup)
            ) {
              let a = 0;
              [
                this.minLabel,
                this.minDateBox,
                this.maxLabel,
                this.maxDateBox,
              ].forEach((b) => {
                if (b) {
                  const { width: c } = b.getBBox();
                  c && (b.attr({ x: a }), (a += c + h.inputSpacing));
                }
              });
            }
            this.alignElements();
            this.rendered = !0;
          }
        }
        renderButtons() {
          const { buttons: a, chart: e, options: b } = this,
            c = B.lang,
            g = e.renderer,
            h = y(b.buttonTheme),
            k = h && h.states,
            n = h.width || 28;
          delete h.width;
          delete h.states;
          this.buttonGroup = g.g('range-selector-buttons').add(this.group);
          const p = (this.dropdown = q(
            'select',
            void 0,
            {
              position: 'absolute',
              width: '1px',
              height: '1px',
              padding: 0,
              border: 0,
              top: '-9999em',
              cursor: 'pointer',
              opacity: 0.0001,
            },
            this.div,
          ));
          u(p, 'touchstart', () => {
            p.style.fontSize = '16px';
          });
          [
            [G.isMS ? 'mouseover' : 'mouseenter'],
            [G.isMS ? 'mouseout' : 'mouseleave'],
            ['change', 'click'],
          ].forEach(([b, c]) => {
            u(p, b, () => {
              const e = a[this.currentButtonIndex()];
              e && d(e.element, c || b);
            });
          });
          this.zoomText = g
            .label((c && c.rangeSelectorZoom) || '', 0)
            .attr({
              padding: b.buttonTheme.padding,
              height: b.buttonTheme.height,
              paddingLeft: 0,
              paddingRight: 0,
            })
            .add(this.buttonGroup);
          this.chart.styledMode ||
            (this.zoomText.css(b.labelStyle),
            (h['stroke-width'] = f(h['stroke-width'], 0)));
          q(
            'option',
            { textContent: this.zoomText.textStr, disabled: !0 },
            void 0,
            p,
          );
          this.buttonOptions.forEach((b, c) => {
            q('option', { textContent: b.title || b.text }, void 0, p);
            a[c] = g
              .button(
                b.text,
                0,
                0,
                (a) => {
                  const e = b.events && b.events.click;
                  let d;
                  e && (d = e.call(b, a));
                  !1 !== d && this.clickButton(c);
                  this.isActive = !0;
                },
                h,
                k && k.hover,
                k && k.select,
                k && k.disabled,
              )
              .attr({ 'text-align': 'center', width: n })
              .add(this.buttonGroup);
            b.title && a[c].attr('title', b.title);
          });
        }
        alignElements() {
          const {
            buttonGroup: a,
            buttons: e,
            chart: b,
            group: c,
            inputGroup: d,
            options: g,
            zoomText: h,
          } = this;
          var k = b.options;
          const n =
              k.exporting &&
              !1 !== k.exporting.enabled &&
              k.navigation &&
              k.navigation.buttonOptions,
            { buttonPosition: p, inputPosition: m, verticalAlign: q } = g;
          k = (a, c) =>
            n &&
            this.titleCollision(b) &&
            'top' === q &&
            'right' === c.align &&
            c.y - a.getBBox().height - 12 <
              (n.y || 0) + (n.height || 0) + b.spacing[0]
              ? -40
              : 0;
          var t = b.plotLeft;
          if (c && p && m) {
            var r = p.x - b.spacing[3];
            if (a) {
              this.positionButtons();
              if (!this.initialButtonGroupWidth) {
                let a = 0;
                h && (a += h.getBBox().width + 5);
                e.forEach((b, c) => {
                  a += b.width;
                  c !== e.length - 1 && (a += g.buttonSpacing);
                });
                this.initialButtonGroupWidth = a;
              }
              t -= b.spacing[3];
              this.updateButtonStates();
              var v = k(a, p);
              this.alignButtonGroup(v);
              c.placed = a.placed = b.hasLoaded;
            }
            v = 0;
            d &&
              ((v = k(d, m)),
              'left' === m.align
                ? (r = t)
                : 'right' === m.align && (r = -Math.max(b.axisOffset[1], -v)),
              d.align(
                {
                  y: m.y,
                  width: d.getBBox().width,
                  align: m.align,
                  x: m.x + r - 2,
                },
                !0,
                b.spacingBox,
              ),
              (d.placed = b.hasLoaded));
            this.handleCollision(v);
            c.align({ verticalAlign: q }, !0, b.spacingBox);
            k = c.alignAttr.translateY;
            t = c.getBBox().height + 20;
            r = 0;
            'bottom' === q &&
              ((r =
                (r = b.legend && b.legend.options) &&
                'bottom' === r.verticalAlign &&
                r.enabled &&
                !r.floating
                  ? b.legend.legendHeight + f(r.margin, 10)
                  : 0),
              (t = t + r - 20),
              (r =
                k -
                t -
                (g.floating ? 0 : g.y) -
                (b.titleOffset ? b.titleOffset[2] : 0) -
                10));
            if ('top' === q)
              (g.floating && (r = 0),
                b.titleOffset && b.titleOffset[0] && (r = b.titleOffset[0]),
                (r += b.margin[0] - b.spacing[0] || 0));
            else if ('middle' === q)
              if (m.y === p.y) r = k;
              else if (m.y || p.y)
                r = 0 > m.y || 0 > p.y ? r - Math.min(m.y, p.y) : k - t;
            c.translate(g.x, g.y + Math.floor(r));
            const { minInput: l, maxInput: n, dropdown: w } = this;
            g.inputEnabled &&
              l &&
              n &&
              ((l.style.marginTop = c.translateY + 'px'),
              (n.style.marginTop = c.translateY + 'px'));
            w && (w.style.marginTop = c.translateY + 'px');
          }
        }
        alignButtonGroup(a, e) {
          const { chart: b, options: c, buttonGroup: d } = this,
            { buttonPosition: g } = c,
            h = b.plotLeft - b.spacing[3];
          let k = g.x - b.spacing[3];
          'right' === g.align
            ? (k += a - h)
            : 'center' === g.align && (k -= h / 2);
          d &&
            d.align(
              {
                y: g.y,
                width: f(e, this.initialButtonGroupWidth),
                align: g.align,
                x: k,
              },
              !0,
              b.spacingBox,
            );
        }
        positionButtons() {
          const { buttons: a, chart: d, options: b, zoomText: c } = this,
            g = d.hasLoaded ? 'animate' : 'attr',
            { buttonPosition: h } = b,
            k = d.plotLeft;
          let n = k;
          c &&
            'hidden' !== c.visibility &&
            (c[g]({ x: f(k + h.x, k) }), (n += h.x + c.getBBox().width + 5));
          for (let c = 0, d = this.buttonOptions.length; c < d; ++c)
            if ('hidden' !== a[c].visibility)
              (a[c][g]({ x: n }), (n += a[c].width + b.buttonSpacing));
            else a[c][g]({ x: k });
        }
        handleCollision(a) {
          const { chart: d, buttonGroup: b, inputGroup: c } = this,
            { buttonPosition: f, dropdown: g, inputPosition: h } = this.options,
            k = () => {
              let a = 0;
              this.buttons.forEach((b) => {
                b = b.getBBox();
                b.width > a && (a = b.width);
              });
              return a;
            },
            n = (d) => {
              if (c && b) {
                const e =
                    c.alignAttr.translateX +
                    c.alignOptions.x -
                    a +
                    c.getBBox().x +
                    2,
                  g = c.alignOptions.width,
                  l = b.alignAttr.translateX + b.getBBox().x;
                return l + d > e && e + g > l && f.y < h.y + c.getBBox().height;
              }
              return !1;
            },
            p = () => {
              c &&
                b &&
                c.attr({
                  translateX:
                    c.alignAttr.translateX + (d.axisOffset[1] >= -a ? 0 : -a),
                  translateY: c.alignAttr.translateY + b.getBBox().height + 10,
                });
            };
          if (b) {
            if ('always' === g) {
              this.collapseButtons(a);
              n(k()) && p();
              return;
            }
            'never' === g && this.expandButtons();
          }
          c && b
            ? h.align === f.align || n(this.initialButtonGroupWidth + 20)
              ? 'responsive' === g
                ? (this.collapseButtons(a), n(k()) && p())
                : p()
              : 'responsive' === g && this.expandButtons()
            : b &&
              'responsive' === g &&
              (this.initialButtonGroupWidth > d.plotWidth
                ? this.collapseButtons(a)
                : this.expandButtons());
        }
        collapseButtons(a) {
          const {
              buttons: d,
              buttonOptions: b,
              chart: c,
              dropdown: g,
              options: h,
              zoomText: k,
            } = this,
            n =
              (c.userOptions.rangeSelector &&
                c.userOptions.rangeSelector.buttonTheme) ||
              {},
            p = (a) => ({
              text: a ? `${a} \u25be` : '\u25be',
              width: 'auto',
              paddingLeft: f(h.buttonTheme.paddingLeft, n.padding, 8),
              paddingRight: f(h.buttonTheme.paddingRight, n.padding, 8),
            });
          k && k.hide();
          let m = !1;
          b.forEach((a, b) => {
            b = d[b];
            2 !== b.state ? b.hide() : (b.show(), b.attr(p(a.text)), (m = !0));
          });
          m ||
            (g && (g.selectedIndex = 0),
            d[0].show(),
            d[0].attr(p(this.zoomText && this.zoomText.textStr)));
          const { align: q } = h.buttonPosition;
          this.positionButtons();
          ('right' !== q && 'center' !== q) ||
            this.alignButtonGroup(
              a,
              d[this.currentButtonIndex()].getBBox().width,
            );
          this.showDropdown();
        }
        expandButtons() {
          const {
            buttons: a,
            buttonOptions: d,
            options: b,
            zoomText: c,
          } = this;
          this.hideDropdown();
          c && c.show();
          d.forEach((c, d) => {
            d = a[d];
            d.show();
            d.attr({
              text: c.text,
              width: b.buttonTheme.width || 28,
              paddingLeft: f(b.buttonTheme.paddingLeft, 'unset'),
              paddingRight: f(b.buttonTheme.paddingRight, 'unset'),
            });
            2 > d.state && d.setState(0);
          });
          this.positionButtons();
        }
        currentButtonIndex() {
          const { dropdown: a } = this;
          return a && 0 < a.selectedIndex ? a.selectedIndex - 1 : 0;
        }
        showDropdown() {
          const { buttonGroup: a, buttons: d, chart: b, dropdown: c } = this;
          if (a && c) {
            const { translateX: e, translateY: f } = a,
              g = d[this.currentButtonIndex()].getBBox();
            r(c, {
              left: b.plotLeft + e + 'px',
              top: f + 0.5 + 'px',
              width: g.width + 'px',
              height: g.height + 'px',
            });
            this.hasVisibleDropdown = !0;
          }
        }
        hideDropdown() {
          const { dropdown: a } = this;
          a &&
            (r(a, { top: '-9999em', width: '1px', height: '1px' }),
            (this.hasVisibleDropdown = !1));
        }
        getHeight() {
          var a = this.options,
            d = this.group;
          const b = a.y,
            c = a.buttonPosition.y,
            f = a.inputPosition.y;
          if (a.height) return a.height;
          this.alignElements();
          a = d ? d.getBBox(!0).height + 13 + b : 0;
          d = Math.min(f, c);
          if ((0 > f && 0 > c) || (0 < f && 0 < c)) a += Math.abs(d);
          return a;
        }
        titleCollision(a) {
          return !(a.options.title.text || a.options.subtitle.text);
        }
        update(a) {
          const d = this.chart;
          y(!0, d.options.rangeSelector, a);
          this.destroy();
          this.init(d);
          this.render();
        }
        destroy() {
          const a = this,
            d = a.minInput,
            b = a.maxInput;
          a.eventsToUnbind &&
            (a.eventsToUnbind.forEach((a) => a()), (a.eventsToUnbind = void 0));
          v(a.buttons);
          d && (d.onfocus = d.onblur = d.onchange = null);
          b && (b.onfocus = b.onblur = b.onchange = null);
          K(
            a,
            function (b, d) {
              b &&
                'chart' !== d &&
                (b instanceof C
                  ? b.destroy()
                  : b instanceof U.HTMLElement && h(b));
              b !== n.prototype[d] && (a[d] = null);
            },
            this,
          );
        }
      }
      g(n.prototype, {
        defaultButtons: [
          { type: 'month', count: 1, text: '1m', title: 'View 1 month' },
          { type: 'month', count: 3, text: '3m', title: 'View 3 months' },
          { type: 'month', count: 6, text: '6m', title: 'View 6 months' },
          { type: 'ytd', text: 'YTD', title: 'View year to date' },
          { type: 'year', count: 1, text: '1y', title: 'View 1 year' },
          { type: 'all', text: 'All', title: 'View all' },
        ],
        inputTypeFormats: {
          'datetime-local': '%Y-%m-%dT%H:%M:%S',
          date: '%Y-%m-%d',
          time: '%H:%M:%S',
        },
      });
      ('');
      return n;
    },
  );
  M(
    a,
    'Series/XRange/XRangeSeriesDefaults.js',
    [a['Core/Utilities.js']],
    function (a) {
      const { correctFloat: x, isNumber: G, isObject: H } = a;
      ('');
      return {
        colorByPoint: !0,
        dataLabels: {
          formatter: function () {
            let a = this.point.partialFill;
            H(a) && (a = a.amount);
            if (G(a) && 0 < a) return x(100 * a) + '%';
          },
          inside: !0,
          verticalAlign: 'middle',
        },
        tooltip: {
          headerFormat:
            '<span style="font-size: 0.8em">{point.x} - {point.x2}</span><br/>',
          pointFormat:
            '<span style="color:{point.color}">\u25cf</span> {series.name}: <b>{point.yCategory}</b><br/>',
        },
        borderRadius: 3,
        pointRange: 0,
      };
    },
  );
  M(
    a,
    'Series/XRange/XRangePoint.js',
    [a['Core/Series/SeriesRegistry.js'], a['Core/Utilities.js']],
    function (a, A) {
      const {
        series: {
          prototype: {
            pointClass: { prototype: x },
          },
        },
        seriesTypes: {
          column: {
            prototype: { pointClass: H },
          },
        },
      } = a;
      ({ extend: a } = A);
      class C extends H {
        constructor() {
          super(...arguments);
          this.series = this.options = void 0;
        }
        static getColorByCategory(a, x) {
          const z = a.options.colors || a.chart.options.colors;
          a = x.y % (z ? z.length : a.chart.options.chart.colorCount);
          return { colorIndex: a, color: z && z[a] };
        }
        resolveColor() {
          const a = this.series;
          if (a.options.colorByPoint && !this.options.color) {
            const x = C.getColorByCategory(a, this);
            a.chart.styledMode || (this.color = x.color);
            this.options.colorIndex || (this.colorIndex = x.colorIndex);
          } else this.color || (this.color = a.color);
        }
        init() {
          x.init.apply(this, arguments);
          this.y || (this.y = 0);
          return this;
        }
        setState() {
          x.setState.apply(this, arguments);
          this.series.drawPoint(this, this.series.getAnimationVerb());
        }
        getLabelConfig() {
          const a = x.getLabelConfig.call(this),
            A = this.series.yAxis.categories;
          a.x2 = this.x2;
          a.yCategory = this.yCategory = A && A[this.y];
          return a;
        }
        isValid() {
          return 'number' === typeof this.x && 'number' === typeof this.x2;
        }
      }
      a(C.prototype, { ttBelow: !1, tooltipDateKeys: ['x', 'x2'] });
      ('');
      return C;
    },
  );
  M(
    a,
    'Series/XRange/XRangeSeries.js',
    [
      a['Core/Globals.js'],
      a['Core/Color/Color.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Utilities.js'],
      a['Series/XRange/XRangeSeriesDefaults.js'],
      a['Series/XRange/XRangePoint.js'],
    ],
    function (a, A, G, H, C, z) {
      function x() {
        let a, d;
        if (this.isXAxis) {
          a = K(this.dataMax, -Number.MAX_VALUE);
          for (const f of this.series)
            if (f.x2Data)
              for (const e of f.x2Data) e && e > a && ((a = e), (d = !0));
          d && (this.dataMax = a);
        }
      }
      ({ noop: a } = a);
      const { parse: B } = A,
        {
          series: { prototype: u },
          seriesTypes: { column: q },
        } = G,
        {
          addEvent: r,
          clamp: m,
          defined: v,
          extend: h,
          find: g,
          isNumber: d,
          isObject: k,
          merge: y,
          pick: K,
          relativeLength: L,
        } = H,
        f = [];
      class p extends q {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
        static compose(a) {
          H.pushUnique(f, a) && r(a, 'afterGetSeriesExtremes', x);
        }
        init() {
          super.init.apply(this, arguments);
          this.options.stacking = void 0;
        }
        getColumnMetrics() {
          const a = () => {
            for (const a of this.chart.series) {
              const d = a.xAxis;
              a.xAxis = a.yAxis;
              a.yAxis = d;
            }
          };
          a();
          const d = super.getColumnMetrics();
          a();
          return d;
        }
        cropData(a, d, f, e) {
          d = u.cropData.call(this, this.x2Data, d, f, e);
          d.xData = a.slice(d.start, d.end);
          return d;
        }
        findPointIndex(a) {
          const { cropStart: f, points: h } = this,
            { id: e } = a;
          if (e) var b = (b = g(h, (a) => a.id === e)) ? b.index : void 0;
          'undefined' === typeof b &&
            (b = (b = g(h, (b) => b.x === a.x && b.x2 === a.x2 && !b.touched))
              ? b.index
              : void 0);
          this.cropped && d(b) && d(f) && b >= f && (b -= f);
          return b;
        }
        alignDataLabel(a) {
          const d = a.plotX;
          a.plotX = K(a.dlBox && a.dlBox.centerX, a.plotX);
          super.alignDataLabel.apply(this, arguments);
          a.plotX = d;
        }
        translatePoint(a) {
          const f = this.xAxis;
          var g = this.yAxis,
            e = this.columnMetrics,
            b = this.options,
            c = b.minPointLength || 0,
            h = ((a.shapeArgs && a.shapeArgs.width) || 0) / 2,
            p = (this.pointXOffset = e.offset),
            q = K(a.x2, a.x + (a.len || 0)),
            t = b.borderRadius,
            r = a.plotX,
            u = f.translate(q, 0, 0, 0, 1);
          q = Math.abs(u - r);
          const x = this.chart.inverted;
          var z = (K(b.borderWidth, 1) % 2) / 2;
          let B = e.offset,
            E = Math.round(e.width);
          c && ((c -= q), 0 > c && (c = 0), (r -= c / 2), (u += c / 2));
          r = Math.max(r, -10);
          u = m(u, -10, f.len + 10);
          v(a.options.pointWidth) &&
            ((B -= (Math.ceil(a.options.pointWidth) - E) / 2),
            (E = Math.ceil(a.options.pointWidth)));
          b.pointPlacement &&
            d(a.plotY) &&
            g.categories &&
            (a.plotY = g.translate(a.y, 0, 1, 0, 1, b.pointPlacement));
          b = Math.floor(Math.min(r, u)) + z;
          u = Math.floor(Math.max(r, u)) + z - b;
          t = Math.min(
            L('object' === typeof t ? t.radius : t || 0, E),
            Math.min(u, E) / 2,
          );
          t = {
            x: b,
            y: Math.floor(a.plotY + B) + z,
            width: u,
            height: E,
            r: t,
          };
          a.shapeArgs = t;
          x
            ? (a.tooltipPos[1] += p + h)
            : (a.tooltipPos[0] -= h + p - t.width / 2);
          h = t.x;
          p = h + t.width;
          0 > h || p > f.len
            ? ((h = m(h, 0, f.len)),
              (p = m(p, 0, f.len)),
              (z = p - h),
              (a.dlBox = y(t, {
                x: h,
                width: p - h,
                centerX: z ? z / 2 : null,
              })))
            : (a.dlBox = null);
          h = a.tooltipPos;
          p = x ? 1 : 0;
          z = x ? 0 : 1;
          e = this.columnMetrics ? this.columnMetrics.offset : -e.width / 2;
          h[p] = x
            ? h[p] + t.width / 2
            : m(h[p] + (f.reversed ? -1 : 0) * t.width, 0, f.len - 1);
          h[z] = m(h[z] + (x ? -1 : 1) * e, 0, g.len - 1);
          if ((g = a.partialFill))
            (k(g) && (g = g.amount),
              d(g) || (g = 0),
              (a.partShapeArgs = y(t)),
              (r = Math.max(Math.round(q * g + a.plotX - r), 0)),
              (a.clipRectArgs = {
                x: f.reversed ? t.x + q - r : t.x,
                y: t.y,
                width: r,
                height: t.height,
              }));
        }
        translate() {
          super.translate.apply(this, arguments);
          for (const a of this.points) this.translatePoint(a);
        }
        drawPoint(a, d) {
          const f = this.options,
            e = this.chart.renderer,
            b = a.shapeType,
            c = a.shapeArgs,
            g = a.partShapeArgs,
            h = a.clipRectArgs;
          var n = a.state,
            p = f.states[n || 'normal'] || {};
          const m = 'undefined' === typeof n ? 'attr' : d;
          n = this.pointAttribs(a, n);
          p = K(this.chart.options.chart.animation, p.animation);
          let q = a.graphic,
            t = a.partialFill;
          if (a.isNull || !1 === a.visible) q && (a.graphic = q.destroy());
          else {
            if (q) q.rect[d](c);
            else
              ((a.graphic = q =
                e
                  .g('point')
                  .addClass(a.getClassName())
                  .add(a.group || this.group)),
                (q.rect = e[b](y(c))
                  .addClass(a.getClassName())
                  .addClass('highcharts-partfill-original')
                  .add(q)));
            g &&
              (q.partRect
                ? (q.partRect[d](y(g)), q.partialClipRect[d](y(h)))
                : ((q.partialClipRect = e.clipRect(
                    h.x,
                    h.y,
                    h.width,
                    h.height,
                  )),
                  (q.partRect = e[b](g)
                    .addClass('highcharts-partfill-overlay')
                    .add(q)
                    .clip(q.partialClipRect))));
            this.chart.styledMode ||
              (q.rect[d](n, p).shadow(f.shadow),
              g &&
                (k(t) || (t = {}),
                k(f.partialFill) && (t = y(f.partialFill, t)),
                (a =
                  t.fill ||
                  B(n.fill).brighten(-0.3).get() ||
                  B(a.color || this.color)
                    .brighten(-0.3)
                    .get()),
                (n.fill = a),
                q.partRect[m](n, p).shadow(f.shadow)));
          }
        }
        drawPoints() {
          const a = this.getAnimationVerb();
          for (const d of this.points) this.drawPoint(d, a);
        }
        getAnimationVerb() {
          return this.chart.pointCount < (this.options.animationLimit || 250)
            ? 'animate'
            : 'attr';
        }
        isPointInside(a) {
          const d = a.shapeArgs,
            f = a.plotX,
            e = a.plotY;
          return d
            ? 'undefined' !== typeof f &&
                'undefined' !== typeof e &&
                0 <= e &&
                e <= this.yAxis.len &&
                0 <= (d.x || 0) + (d.width || 0) &&
                f <= this.xAxis.len
            : super.isPointInside.apply(this, arguments);
        }
      }
      p.defaultOptions = y(q.defaultOptions, C);
      h(p.prototype, {
        pointClass: z,
        cropShoulder: 1,
        getExtremesFromAll: !0,
        parallelArrays: ['x', 'x2', 'y'],
        requireSorting: !1,
        type: 'xrange',
        animate: u.animate,
        autoIncrement: a,
        buildKDTree: a,
      });
      G.registerSeriesType('xrange', p);
      return p;
    },
  );
  M(
    a,
    'Series/Gantt/GanttPoint.js',
    [a['Core/Series/SeriesRegistry.js'], a['Core/Utilities.js']],
    function (a, A) {
      ({
        seriesTypes: {
          xrange: {
            prototype: { pointClass: a },
          },
        },
      } = a);
      const { pick: x } = A;
      class H extends a {
        constructor() {
          super(...arguments);
          this.series = this.options = void 0;
        }
        static setGanttPointAliases(a) {
          function z(x, z) {
            'undefined' !== typeof z && (a[x] = z);
          }
          z('x', x(a.start, a.x));
          z('x2', x(a.end, a.x2));
          z('partialFill', x(a.completed, a.partialFill));
        }
        applyOptions(a, x) {
          a = super.applyOptions.call(this, a, x);
          H.setGanttPointAliases(a);
          return a;
        }
        isValid() {
          return (
            ('number' === typeof this.start || 'number' === typeof this.x) &&
            ('number' === typeof this.end ||
              'number' === typeof this.x2 ||
              this.milestone)
          );
        }
      }
      return H;
    },
  );
  M(
    a,
    'Core/Axis/BrokenAxis.js',
    [a['Core/Axis/Stacking/StackItem.js'], a['Core/Utilities.js']],
    function (a, A) {
      const {
        addEvent: x,
        find: H,
        fireEvent: C,
        isArray: z,
        isNumber: D,
        pick: B,
      } = A;
      var u;
      (function (q) {
        function r() {
          'undefined' !== typeof this.brokenAxis &&
            this.brokenAxis.setBreaks(this.options.breaks, !1);
        }
        function m() {
          this.brokenAxis &&
            this.brokenAxis.hasBreaks &&
            (this.options.ordinal = !1);
        }
        function v() {
          const a = this.brokenAxis;
          if (a && a.hasBreaks) {
            const d = this.tickPositions,
              f = this.tickPositions.info,
              g = [];
            for (let f = 0; f < d.length; f++)
              a.isInAnyBreak(d[f]) || g.push(d[f]);
            this.tickPositions = g;
            this.tickPositions.info = f;
          }
        }
        function h() {
          this.brokenAxis || (this.brokenAxis = new G(this));
        }
        function g() {
          const {
            isDirty: a,
            options: { connectNulls: d },
            points: g,
            xAxis: h,
            yAxis: k,
          } = this;
          if (a) {
            let a = g.length;
            for (; a--; ) {
              const b = g[a],
                c =
                  !(null === b.y && !1 === d) &&
                  ((h && h.brokenAxis && h.brokenAxis.isInAnyBreak(b.x, !0)) ||
                    (k && k.brokenAxis && k.brokenAxis.isInAnyBreak(b.y, !0)));
              b.visible = c ? !1 : !1 !== b.options.visible;
            }
          }
        }
        function d() {
          this.drawBreaks(this.xAxis, ['x']);
          this.drawBreaks(this.yAxis, B(this.pointArrayMap, ['y']));
        }
        function k(a, d) {
          const f = this,
            g = f.points;
          let h, e, b, c;
          if (a && a.brokenAxis && a.brokenAxis.hasBreaks) {
            const l = a.brokenAxis;
            d.forEach(function (d) {
              h = (l && l.breakArray) || [];
              e = a.isXAxis ? a.min : B(f.options.threshold, a.min);
              g.forEach(function (f) {
                c = B(f['stack' + d.toUpperCase()], f[d]);
                h.forEach(function (d) {
                  if (D(e) && D(c)) {
                    b = !1;
                    if ((e < d.from && c > d.to) || (e > d.from && c < d.from))
                      b = 'pointBreak';
                    else if (
                      (e < d.from && c > d.from && c < d.to) ||
                      (e > d.from && c > d.to && c < d.from)
                    )
                      b = 'pointInBreak';
                    b && C(a, b, { point: f, brk: d });
                  }
                });
              });
            });
          }
        }
        function u() {
          var d = this.currentDataGrouping,
            g = d && d.gapSize;
          d = this.points.slice();
          const h = this.yAxis;
          let k = this.options.gapSize,
            m = d.length - 1;
          var e;
          if (k && 0 < m)
            for (
              'value' !== this.options.gapUnit && (k *= this.basePointRange),
                g && g > k && g >= this.basePointRange && (k = g);
              m--;
            )
              ((e && !1 !== e.visible) || (e = d[m + 1]),
                (g = d[m]),
                !1 !== e.visible &&
                  !1 !== g.visible &&
                  (e.x - g.x > k &&
                    ((e = (g.x + e.x) / 2),
                    d.splice(m + 1, 0, { isNull: !0, x: e }),
                    h.stacking &&
                      this.options.stacking &&
                      ((e = h.stacking.stacks[this.stackKey][e] =
                        new a(h, h.options.stackLabels, !1, e, this.stack)),
                      (e.total = 0))),
                  (e = g)));
          return this.getGraphPath(d);
        }
        const K = [];
        q.compose = function (a, p) {
          A.pushUnique(K, a) &&
            (a.keepProps.push('brokenAxis'),
            x(a, 'init', h),
            x(a, 'afterInit', r),
            x(a, 'afterSetTickPositions', v),
            x(a, 'afterSetOptions', m));
          if (A.pushUnique(K, p)) {
            const a = p.prototype;
            a.drawBreaks = k;
            a.gappedPath = u;
            x(p, 'afterGeneratePoints', g);
            x(p, 'afterRender', d);
          }
          return a;
        };
        class G {
          static isInBreak(a, d) {
            const f = a.repeat || Infinity,
              g = a.from,
              h = a.to - a.from;
            d = d >= g ? (d - g) % f : f - ((g - d) % f);
            return a.inclusive ? d <= h : d < h && 0 !== d;
          }
          static lin2Val(a) {
            var d = this.brokenAxis;
            d = d && d.breakArray;
            if (!d || !D(a)) return a;
            let f, g;
            for (g = 0; g < d.length && !((f = d[g]), f.from >= a); g++)
              f.to < a ? (a += f.len) : G.isInBreak(f, a) && (a += f.len);
            return a;
          }
          static val2Lin(a) {
            var d = this.brokenAxis;
            d = d && d.breakArray;
            if (!d || !D(a)) return a;
            let f = a,
              g,
              h;
            for (h = 0; h < d.length; h++)
              if (((g = d[h]), g.to <= a)) f -= g.len;
              else if (g.from >= a) break;
              else if (G.isInBreak(g, a)) {
                f -= a - g.from;
                break;
              }
            return f;
          }
          constructor(a) {
            this.hasBreaks = !1;
            this.axis = a;
          }
          findBreakAt(a, d) {
            return H(d, function (d) {
              return d.from < a && a < d.to;
            });
          }
          isInAnyBreak(a, d) {
            const f = this.axis,
              g = f.options.breaks || [];
            let h = g.length,
              e,
              b,
              c;
            if (h && D(a)) {
              for (; h--; )
                G.isInBreak(g[h], a) &&
                  ((e = !0), b || (b = B(g[h].showPoints, !f.isXAxis)));
              c = e && d ? e && !b : e;
            }
            return c;
          }
          setBreaks(a, d) {
            const f = this,
              g = f.axis,
              h = z(a) && !!a.length;
            g.isDirty = f.hasBreaks !== h;
            f.hasBreaks = h;
            a !== g.options.breaks &&
              (g.options.breaks = g.userOptions.breaks = a);
            g.forceRedraw = !0;
            g.series.forEach(function (a) {
              a.isDirty = !0;
            });
            h ||
              g.val2lin !== G.val2Lin ||
              (delete g.val2lin, delete g.lin2val);
            h &&
              ((g.userOptions.ordinal = !1),
              (g.lin2val = G.lin2Val),
              (g.val2lin = G.val2Lin),
              (g.setExtremes = function (a, b, c, d, h) {
                if (f.hasBreaks) {
                  const c = this.options.breaks || [];
                  let d;
                  for (; (d = f.findBreakAt(a, c)); ) a = d.to;
                  for (; (d = f.findBreakAt(b, c)); ) b = d.from;
                  b < a && (b = a);
                }
                g.constructor.prototype.setExtremes.call(this, a, b, c, d, h);
              }),
              (g.setAxisTranslation = function () {
                g.constructor.prototype.setAxisTranslation.call(this);
                f.unitLength = void 0;
                if (f.hasBreaks) {
                  const a = g.options.breaks || [],
                    b = [],
                    c = [],
                    d = B(g.pointRangePadding, 0);
                  let h = 0,
                    k,
                    n,
                    m = g.userMin || g.min,
                    p = g.userMax || g.max,
                    q,
                    t;
                  a.forEach(function (a) {
                    n = a.repeat || Infinity;
                    D(m) &&
                      D(p) &&
                      (G.isInBreak(a, m) && (m += (a.to % n) - (m % n)),
                      G.isInBreak(a, p) && (p -= (p % n) - (a.from % n)));
                  });
                  a.forEach(function (a) {
                    q = a.from;
                    n = a.repeat || Infinity;
                    if (D(m) && D(p)) {
                      for (; q - n > m; ) q -= n;
                      for (; q < m; ) q += n;
                      for (t = q; t < p; t += n)
                        (b.push({ value: t, move: 'in' }),
                          b.push({
                            value: t + a.to - a.from,
                            move: 'out',
                            size: a.breakSize,
                          }));
                    }
                  });
                  b.sort(function (a, b) {
                    return a.value === b.value
                      ? ('in' === a.move ? 0 : 1) - ('in' === b.move ? 0 : 1)
                      : a.value - b.value;
                  });
                  k = 0;
                  q = m;
                  b.forEach(function (a) {
                    k += 'in' === a.move ? 1 : -1;
                    1 === k && 'in' === a.move && (q = a.value);
                    0 === k &&
                      D(q) &&
                      (c.push({
                        from: q,
                        to: a.value,
                        len: a.value - q - (a.size || 0),
                      }),
                      (h += a.value - q - (a.size || 0)));
                  });
                  f.breakArray = c;
                  D(m) &&
                    D(p) &&
                    D(g.min) &&
                    ((f.unitLength = p - m - h + d),
                    C(g, 'afterBreaks'),
                    g.staticScale
                      ? (g.transA = g.staticScale)
                      : f.unitLength &&
                        (g.transA *= (p - g.min + d) / f.unitLength),
                    d &&
                      (g.minPixelPadding = g.transA * (g.minPointOffset || 0)),
                    (g.min = m),
                    (g.max = p));
                }
              }));
            B(d, !0) && g.chart.redraw();
          }
        }
        q.Additions = G;
      })(u || (u = {}));
      return u;
    },
  );
  M(
    a,
    'Core/Axis/GridAxis.js',
    [a['Core/Axis/Axis.js'], a['Core/Globals.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      function x(a, c) {
        const d = { width: 0, height: 0 };
        c.forEach(function (c) {
          c = a[c];
          let e, f;
          G.isObject(c, !0) &&
            ((f = G.isObject(c.label, !0) ? c.label : {}),
            (c = f.getBBox ? f.getBBox().height : 0),
            f.textStr &&
              !b(f.textPxLength) &&
              (f.textPxLength = f.getBBox().width),
            (e = b(f.textPxLength) ? Math.round(f.textPxLength) : 0),
            f.textStr && (e = Math.round(f.getBBox().width)),
            (d.height = Math.max(c, d.height)),
            (d.width = Math.max(e, d.width)));
        });
        'treegrid' === this.options.type &&
          this.treeGrid &&
          this.treeGrid.mapOfPosToGridNode &&
          (d.width +=
            this.options.labels.indentation *
            ((this.treeGrid.mapOfPosToGridNode[-1].height || 0) - 1));
        return d;
      }
      function C() {
        const { grid: a } = this;
        ((a && a.columns) || []).forEach(function (a) {
          a.getOffset();
        });
      }
      function z(a) {
        if (!0 === (this.options.grid || {}).enabled) {
          const {
            axisTitle: c,
            height: d,
            horiz: e,
            left: f,
            offset: g,
            opposite: h,
            options: k,
            top: n,
            width: m,
          } = this;
          var b = this.tickSize();
          const p = c && c.getBBox().width,
            q = k.title.x,
            t = k.title.y,
            r = l(k.title.margin, e ? 5 : 10),
            v = c ? this.chart.renderer.fontMetrics(c).f : 0;
          b =
            (e ? n + d : f) +
            (e ? 1 : -1) * (h ? -1 : 1) * (b ? b[0] / 2 : 0) +
            (this.side === J.bottom ? v : 0);
          a.titlePosition.x = e
            ? f - (p || 0) / 2 - r + q
            : b + (h ? m : 0) + g + q;
          a.titlePosition.y = e
            ? b - (h ? d : 0) + (h ? v : -v) / 2 + g + t
            : n - r + t;
        }
      }
      function D() {
        const {
          chart: b,
          options: { grid: d = {} },
          userOptions: e,
        } = this;
        if (d.enabled) {
          var f = this.options;
          f.labels.align = l(f.labels.align, 'center');
          this.categories || (f.showLastLabel = !1);
          this.labelRotation = 0;
          f.labels.rotation = 0;
        }
        if (d.columns) {
          f = this.grid.columns = [];
          let h = (this.grid.columnIndex = 0);
          for (; ++h < d.columns.length; ) {
            var g = c(e, d.columns[d.columns.length - h - 1], {
              isInternal: !0,
              linkedTo: 0,
              type: 'category',
              scrollbar: { enabled: !1 },
            });
            delete g.grid.columns;
            g = new a(this.chart, g, 'yAxis');
            g.grid.isColumn = !0;
            g.grid.columnIndex = h;
            n(b.axes, g);
            n(b[this.coll] || [], g);
            f.push(g);
          }
        }
      }
      function B() {
        var a = this.grid,
          b = this.options;
        if (!0 === (b.grid || {}).enabled) {
          var c = this.min || 0;
          const h = this.max || 0;
          this.maxLabelDimensions = this.getMaxLabelDimensions(
            this.ticks,
            this.tickPositions,
          );
          this.rightWall && this.rightWall.destroy();
          if (this.grid && this.grid.isOuterAxis() && this.axisLine) {
            var d = b.lineWidth;
            if (d) {
              d = this.getLinePath(d);
              var e = d[0],
                f = d[1],
                g =
                  ((this.tickSize('tick') || [1])[0] - 1) *
                  (this.side === J.top || this.side === J.left ? -1 : 1);
              'M' === e[0] &&
                'L' === f[0] &&
                (this.horiz
                  ? ((e[2] += g), (f[2] += g))
                  : ((e[1] += g), (f[1] += g)));
              !this.horiz &&
                this.chart.marginRight &&
                ((e = [e, ['L', this.left, e[2] || 0]]),
                (g = [
                  'L',
                  this.chart.chartWidth - this.chart.marginRight,
                  this.toPixels(h + this.tickmarkOffset),
                ]),
                (f = [
                  ['M', f[1] || 0, this.toPixels(h + this.tickmarkOffset)],
                  g,
                ]),
                this.grid.upperBorder ||
                  0 === c % 1 ||
                  (this.grid.upperBorder = this.grid.renderBorder(e)),
                this.grid.upperBorder &&
                  (this.grid.upperBorder.attr({
                    stroke: b.lineColor,
                    'stroke-width': b.lineWidth,
                  }),
                  this.grid.upperBorder.animate({ d: e })),
                this.grid.lowerBorder ||
                  0 === h % 1 ||
                  (this.grid.lowerBorder = this.grid.renderBorder(f)),
                this.grid.lowerBorder &&
                  (this.grid.lowerBorder.attr({
                    stroke: b.lineColor,
                    'stroke-width': b.lineWidth,
                  }),
                  this.grid.lowerBorder.animate({ d: f })));
              this.grid.axisLineExtra
                ? (this.grid.axisLineExtra.attr({
                    stroke: b.lineColor,
                    'stroke-width': b.lineWidth,
                  }),
                  this.grid.axisLineExtra.animate({ d }))
                : (this.grid.axisLineExtra = this.grid.renderBorder(d));
              this.axisLine[this.showAxis ? 'show' : 'hide']();
            }
          }
          ((a && a.columns) || []).forEach((a) => a.render());
          if (
            !this.horiz &&
            this.chart.hasRendered &&
            (this.scrollbar ||
              (this.linkedParent && this.linkedParent.scrollbar))
          ) {
            a = this.tickmarkOffset;
            b = this.tickPositions[this.tickPositions.length - 1];
            d = this.tickPositions[0];
            let e, f;
            for (; (e = this.hiddenLabels.pop()) && e.element; ) e.show();
            for (; (f = this.hiddenMarks.pop()) && f.element; ) f.show();
            (e = this.ticks[d].label) &&
              (c - d > a ? this.hiddenLabels.push(e.hide()) : e.show());
            (e = this.ticks[b].label) &&
              (b - h > a ? this.hiddenLabels.push(e.hide()) : e.show());
            (c = this.ticks[b].mark) &&
              b - h < a &&
              0 < b - h &&
              this.ticks[b].isLast &&
              this.hiddenMarks.push(c.hide());
          }
        }
      }
      function u() {
        const a = this.tickPositions && this.tickPositions.info,
          b = this.options,
          c = this.userOptions.labels || {};
        (b.grid || {}).enabled &&
          (this.horiz
            ? (this.series.forEach((a) => {
                a.options.pointRange = 0;
              }),
              a &&
                b.dateTimeLabelFormats &&
                b.labels &&
                !t(c.align) &&
                (!1 === b.dateTimeLabelFormats[a.unitName].range ||
                  1 < a.count) &&
                ((b.labels.align = 'left'), t(c.x) || (b.labels.x = 3)))
            : 'treegrid' !== this.options.type &&
              this.grid &&
              this.grid.columns &&
              (this.minPointOffset = this.tickInterval));
      }
      function q(a) {
        const d = this.options;
        a = a.userOptions;
        const e = d && G.isObject(d.grid, !0) ? d.grid : {};
        let f;
        !0 === e.enabled &&
          ((f = c(
            !0,
            {
              className: 'highcharts-grid-axis ' + (a.className || ''),
              dateTimeLabelFormats: {
                hour: { list: ['%H:%M', '%H'] },
                day: { list: ['%A, %e. %B', '%a, %e. %b', '%E'] },
                week: { list: ['Week %W', 'W%W'] },
                month: { list: ['%B', '%b', '%o'] },
              },
              grid: { borderWidth: 1 },
              labels: { padding: 2, style: { fontSize: '0.9em' } },
              margin: 0,
              title: { text: null, reserveSpace: !1, rotation: 0 },
              units: [
                ['millisecond', [1, 10, 100]],
                ['second', [1, 10]],
                ['minute', [1, 5, 15]],
                ['hour', [1, 6]],
                ['day', [1]],
                ['week', [1]],
                ['month', [1]],
                ['year', null],
              ],
            },
            a,
          )),
          'xAxis' === this.coll &&
            (t(a.linkedTo) &&
              !t(a.tickPixelInterval) &&
              (f.tickPixelInterval = 350),
            t(a.tickPixelInterval) ||
              !t(a.linkedTo) ||
              t(a.tickPositioner) ||
              t(a.tickInterval) ||
              (f.tickPositioner = function (a, c) {
                var d =
                  this.linkedParent &&
                  this.linkedParent.tickPositions &&
                  this.linkedParent.tickPositions.info;
                if (d) {
                  var e = f.units || [];
                  let h;
                  var g = 1;
                  let k = 'year';
                  for (let a = 0; a < e.length; a++) {
                    const b = e[a];
                    if (b && b[0] === d.unitName) {
                      h = a;
                      break;
                    }
                  }
                  (e = b(h) && e[h + 1])
                    ? ((k = e[0] || 'year'), (g = ((g = e[1]) && g[0]) || 1))
                    : 'year' === d.unitName && (g = 10 * d.count);
                  d = I[k];
                  this.tickInterval = d * g;
                  return this.chart.time.getTimeTicks(
                    { unitRange: d, count: g, unitName: k },
                    a,
                    c,
                    this.options.startOfWeek,
                  );
                }
              })),
          c(!0, this.options, f),
          this.horiz &&
            ((d.minPadding = l(a.minPadding, 0)),
            (d.maxPadding = l(a.maxPadding, 0))),
          b(d.grid.borderWidth) && (d.tickWidth = d.lineWidth = e.borderWidth));
      }
      function r(a) {
        a = ((a = a.userOptions) && a.grid) || {};
        const b = a.columns;
        a.enabled && b && c(!0, this.options, b[b.length - 1]);
      }
      function m() {
        (this.grid.columns || []).forEach((a) => a.setScale());
      }
      function v(a) {
        const {
          horiz: b,
          maxLabelDimensions: c,
          options: { grid: d = {} },
        } = this;
        if (d.enabled && c) {
          var f = 2 * this.options.labels.distance;
          f = b ? d.cellHeight || f + c.height : f + c.width;
          e(a.tickSize) ? (a.tickSize[0] = f) : (a.tickSize = [f, 0]);
        }
      }
      function h() {
        this.axes.forEach((a) => {
          ((a.grid && a.grid.columns) || []).forEach((a) => {
            a.setAxisSize();
            a.setAxisTranslation();
          });
        });
      }
      function g(a) {
        const { grid: b } = this;
        (b.columns || []).forEach((b) => b.destroy(a.keepEvents));
        b.columns = void 0;
      }
      function d(a) {
        a = a.userOptions || {};
        const b = a.grid || {};
        b.enabled &&
          t(b.borderColor) &&
          (a.tickColor = a.lineColor = b.borderColor);
        this.grid || (this.grid = new P(this));
        this.hiddenLabels = [];
        this.hiddenMarks = [];
      }
      function k(a) {
        var c = this.label;
        const d = this.axis;
        var e = d.reversed,
          f = d.chart,
          g = d.options.grid || {};
        const h = d.options.labels,
          k = h.align;
        var l = J[d.side],
          n = a.tickmarkOffset,
          m = d.tickPositions;
        const p = this.pos - n;
        m = b(m[a.index + 1]) ? m[a.index + 1] - n : (d.max || 0) + n;
        var q = d.tickSize('tick');
        n = q ? q[0] : 0;
        q = q ? q[1] / 2 : 0;
        if (!0 === g.enabled) {
          let b;
          'top' === l
            ? ((g = d.top + d.offset), (b = g - n))
            : 'bottom' === l
              ? ((b = f.chartHeight - d.bottom + d.offset), (g = b + n))
              : ((g = d.top + d.len - (d.translate(e ? m : p) || 0)),
                (b = d.top + d.len - (d.translate(e ? p : m) || 0)));
          'right' === l
            ? ((l = f.chartWidth - d.right + d.offset), (e = l + n))
            : 'left' === l
              ? ((e = d.left + d.offset), (l = e - n))
              : ((l = Math.round(d.left + (d.translate(e ? m : p) || 0)) - q),
                (e = Math.min(
                  Math.round(d.left + (d.translate(e ? p : m) || 0)) - q,
                  d.left + d.len,
                )));
          this.slotWidth = e - l;
          a.pos.x = 'left' === k ? l : 'right' === k ? e : l + (e - l) / 2;
          a.pos.y = b + (g - b) / 2;
          c &&
            ((f = f.renderer.fontMetrics(c)),
            (c = c.getBBox().height),
            (a.pos.y = h.useHTML
              ? a.pos.y + (f.b + -(c / 2))
              : a.pos.y +
                ((f.b - (f.h - f.f)) / 2 +
                  -(((Math.round(c / f.h) - 1) * f.h) / 2))));
          a.pos.x += (d.horiz && h.x) || 0;
        }
      }
      function y(a) {
        const { axis: b, value: d } = a;
        if (b.options.grid && b.options.grid.enabled) {
          var e = b.tickPositions;
          const f = (b.linkedParent || b).series[0],
            g = d === e[0];
          e = d === e[e.length - 1];
          const h =
            f &&
            w(f.options.data, function (a) {
              return a[b.isXAxis ? 'x' : 'y'] === d;
            });
          let l;
          h &&
            f.is('gantt') &&
            ((l = c(h)),
            A.seriesTypes.gantt.prototype.pointClass.setGanttPointAliases(l));
          a.isFirst = g;
          a.isLast = e;
          a.point = l;
        }
      }
      function K() {
        const a = this.options,
          b = this.categories,
          c = this.tickPositions,
          d = c[0],
          e = c[c.length - 1],
          f = (this.linkedParent && this.linkedParent.min) || this.min,
          g = (this.linkedParent && this.linkedParent.max) || this.max,
          h = this.tickInterval;
        !0 !== (a.grid || {}).enabled ||
          b ||
          (!this.horiz && !this.isLinked) ||
          (d < f && d + h > f && !a.startOnTick && (c[0] = f),
          e > g && e - h < g && !a.endOnTick && (c[c.length - 1] = g));
      }
      function L(a) {
        const {
          options: { grid: b = {} },
        } = this;
        return !0 === b.enabled && this.categories
          ? this.tickInterval
          : a.apply(this, Array.prototype.slice.call(arguments, 1));
      }
      const { dateFormats: f } = A,
        {
          addEvent: p,
          defined: t,
          erase: n,
          find: w,
          isArray: e,
          isNumber: b,
          merge: c,
          pick: l,
          timeUnits: I,
          wrap: F,
        } = G;
      var J;
      (function (a) {
        a[(a.top = 0)] = 'top';
        a[(a.right = 1)] = 'right';
        a[(a.bottom = 2)] = 'bottom';
        a[(a.left = 3)] = 'left';
      })(J || (J = {}));
      const M = [];
      class P {
        constructor(a) {
          this.axis = a;
        }
        isOuterAxis() {
          const a = this.axis,
            c = a.grid.columnIndex,
            d =
              (a.linkedParent && a.linkedParent.grid.columns) || a.grid.columns,
            e = c ? a.linkedParent : a;
          let f = -1,
            g = 0;
          (a.chart[a.coll] || []).forEach((b, c) => {
            b.side !== a.side ||
              b.options.isInternal ||
              ((g = c), b === e && (f = c));
          });
          return g === f && (b(c) ? d.length === c : !0);
        }
        renderBorder(a) {
          const b = this.axis,
            c = b.chart.renderer,
            d = b.options;
          a = c.path(a).addClass('highcharts-axis-line').add(b.axisBorder);
          c.styledMode ||
            a.attr({
              stroke: d.lineColor,
              'stroke-width': d.lineWidth,
              zIndex: 7,
            });
          return a;
        }
      }
      f.E = function (a) {
        return this.dateFormat('%a', a, !0).charAt(0);
      };
      f.W = function (a) {
        const b = this,
          c = new this.Date(a);
        ['Hours', 'Milliseconds', 'Minutes', 'Seconds'].forEach(function (a) {
          b.set(a, c, 0);
        });
        var d = (this.get('Day', c) + 6) % 7;
        a = new this.Date(c.valueOf());
        this.set('Date', a, this.get('Date', c) - d + 3);
        d = new this.Date(this.get('FullYear', a), 0, 1);
        4 !== this.get('Day', d) &&
          (this.set('Month', c, 0),
          this.set('Date', c, 1 + ((11 - this.get('Day', d)) % 7)));
        return (
          1 + Math.floor((a.valueOf() - d.valueOf()) / 6048e5)
        ).toString();
      };
      ('');
      return {
        compose: function (a, b, c) {
          G.pushUnique(M, a) &&
            (a.keepProps.push('grid'),
            (a.prototype.getMaxLabelDimensions = x),
            F(a.prototype, 'unsquish', L),
            p(a, 'init', d),
            p(a, 'afterGetOffset', C),
            p(a, 'afterGetTitlePosition', z),
            p(a, 'afterInit', D),
            p(a, 'afterRender', B),
            p(a, 'afterSetAxisTranslation', u),
            p(a, 'afterSetOptions', q),
            p(a, 'afterSetOptions', r),
            p(a, 'afterSetScale', m),
            p(a, 'afterTickSize', v),
            p(a, 'trimTicks', K),
            p(a, 'destroy', g));
          G.pushUnique(M, b) && p(b, 'afterSetChartSize', h);
          G.pushUnique(M, c) &&
            (p(c, 'afterGetLabelPosition', k), p(c, 'labelFormat', y));
          return a;
        },
      };
    },
  );
  M(a, 'Gantt/Tree.js', [a['Core/Utilities.js']], function (a) {
    const { extend: x, isNumber: G, pick: H } = a,
      C = function (a, x) {
        const u = a.reduce(function (a, r) {
          const m = H(r.parent, '');
          'undefined' === typeof a[m] && (a[m] = []);
          a[m].push(r);
          return a;
        }, {});
        Object.keys(u).forEach(function (a, r) {
          const m = u[a];
          '' !== a &&
            -1 === x.indexOf(a) &&
            (m.forEach(function (a) {
              r[''].push(a);
            }),
            delete r[a]);
        });
        return u;
      },
      z = function (a, B, u, q, r, m) {
        let v = 0,
          h = 0,
          g = m && m.after;
        var d = m && m.before;
        B = { data: q, depth: u - 1, id: a, level: u, parent: B };
        let k, y;
        'function' === typeof d && d(B, m);
        d = (r[a] || []).map(function (d) {
          const g = z(d.id, a, u + 1, d, r, m),
            f = d.start;
          d = !0 === d.milestone ? f : d.end;
          k = !G(k) || f < k ? f : k;
          y = !G(y) || d > y ? d : y;
          v = v + 1 + g.descendants;
          h = Math.max(g.height + 1, h);
          return g;
        });
        q && ((q.start = H(q.start, k)), (q.end = H(q.end, y)));
        x(B, { children: d, descendants: v, height: h });
        'function' === typeof g && g(B, m);
        return B;
      };
    return {
      getListOfParents: C,
      getNode: z,
      getTree: function (a, x) {
        const u = a.map(function (a) {
          return a.id;
        });
        a = C(a, u);
        return z('', null, 1, null, a, x);
      },
    };
  });
  M(
    a,
    'Core/Axis/TreeGrid/TreeGridTick.js',
    [a['Core/Utilities.js']],
    function (a) {
      function x() {
        this.treeGrid || (this.treeGrid = new m(this));
      }
      function G(a, h) {
        a = a.treeGrid;
        const g = !a.labelIcon,
          d = h.renderer;
        var k = h.xy;
        const m = h.options,
          q = m.width || 0,
          r = m.height || 0;
        var f = k.x - q / 2 - (m.padding || 0);
        k = k.y - r / 2;
        const p = h.collapsed ? 90 : 180,
          t = h.show && B(k);
        let n = a.labelIcon;
        n ||
          (a.labelIcon = n =
            d
              .path(d.symbols[m.type](m.x || 0, m.y || 0, q, r))
              .addClass('highcharts-label-icon')
              .add(h.group));
        n[t ? 'show' : 'hide']();
        d.styledMode ||
          n.attr({
            cursor: 'pointer',
            fill: u(h.color, '#666666'),
            'stroke-width': 1,
            stroke: m.lineColor,
            strokeWidth: m.lineWidth || 0,
          });
        n[g ? 'attr' : 'animate']({
          translateX: f,
          translateY: k,
          rotation: p,
        });
      }
      function H(a, h, g, d, k, m, q, r, f) {
        var p = u(this.options && this.options.labels, m);
        m = this.pos;
        var t = this.axis;
        const n = 'treegrid' === t.options.type;
        a = a.apply(this, [h, g, d, k, p, q, r, f]);
        n &&
          ((h = p && D(p.symbol, !0) ? p.symbol : {}),
          (p = p && B(p.indentation) ? p.indentation : 0),
          (m =
            ((m = (t = t.treeGrid.mapOfPosToGridNode) && t[m]) && m.depth) ||
            1),
          (a.x += (h.width || 0) + 2 * (h.padding || 0) + (m - 1) * p));
        return a;
      }
      function C(a) {
        const h = this;
        var g = h.pos,
          d = h.axis;
        const k = h.label;
        var m = d.treeGrid.mapOfPosToGridNode,
          q = d.options;
        const r = u(h.options && h.options.labels, q && q.labels);
        var f = r && D(r.symbol, !0) ? r.symbol : {};
        const p = (m = m && m[g]) && m.depth;
        q = 'treegrid' === q.type;
        const t = -1 < d.tickPositions.indexOf(g);
        g = d.chart.styledMode;
        q &&
          m &&
          k &&
          k.element &&
          k.addClass('highcharts-treegrid-node-level-' + p);
        a.apply(h, Array.prototype.slice.call(arguments, 1));
        q &&
          k &&
          k.element &&
          m &&
          m.descendants &&
          0 < m.descendants &&
          ((d = d.treeGrid.isCollapsed(m)),
          G(h, {
            color: (!g && k.styles && k.styles.color) || '',
            collapsed: d,
            group: k.parentGroup,
            options: f,
            renderer: k.renderer,
            show: t,
            xy: k.xy,
          }),
          (f = 'highcharts-treegrid-node-' + (d ? 'expanded' : 'collapsed')),
          k
            .addClass(
              'highcharts-treegrid-node-' + (d ? 'collapsed' : 'expanded'),
            )
            .removeClass(f),
          g || k.css({ cursor: 'pointer' }),
          [k, h.treeGrid.labelIcon].forEach((a) => {
            a &&
              !a.attachedTreeGridEvents &&
              (z(a.element, 'mouseover', function () {
                k.addClass('highcharts-treegrid-node-active');
                k.renderer.styledMode || k.css({ textDecoration: 'underline' });
              }),
              z(a.element, 'mouseout', function () {
                {
                  const a = D(r.style) ? r.style : {};
                  k.removeClass('highcharts-treegrid-node-active');
                  k.renderer.styledMode ||
                    k.css({ textDecoration: a.textDecoration });
                }
              }),
              z(a.element, 'click', function () {
                h.treeGrid.toggleCollapse();
              }),
              (a.attachedTreeGridEvents = !0));
          }));
      }
      const { addEvent: z, isObject: D, isNumber: B, pick: u, wrap: q } = a,
        r = [];
      class m {
        static compose(m) {
          a.pushUnique(r, m) &&
            (z(m, 'init', x),
            q(m.prototype, 'getLabelPosition', H),
            q(m.prototype, 'renderLabel', C),
            (m.prototype.collapse = function (a) {
              this.treeGrid.collapse(a);
            }),
            (m.prototype.expand = function (a) {
              this.treeGrid.expand(a);
            }),
            (m.prototype.toggleCollapse = function (a) {
              this.treeGrid.toggleCollapse(a);
            }));
        }
        constructor(a) {
          this.tick = a;
        }
        collapse(a) {
          var h = this.tick;
          const g = h.axis,
            d = g.brokenAxis;
          d &&
            g.treeGrid.mapOfPosToGridNode &&
            ((h = g.treeGrid.collapse(g.treeGrid.mapOfPosToGridNode[h.pos])),
            d.setBreaks(h, u(a, !0)));
        }
        destroy() {
          this.labelIcon && this.labelIcon.destroy();
        }
        expand(a) {
          var h = this.tick;
          const g = h.axis,
            d = g.brokenAxis;
          d &&
            g.treeGrid.mapOfPosToGridNode &&
            ((h = g.treeGrid.expand(g.treeGrid.mapOfPosToGridNode[h.pos])),
            d.setBreaks(h, u(a, !0)));
        }
        toggleCollapse(a) {
          var h = this.tick;
          const g = h.axis,
            d = g.brokenAxis;
          d &&
            g.treeGrid.mapOfPosToGridNode &&
            ((h = g.treeGrid.toggleCollapse(
              g.treeGrid.mapOfPosToGridNode[h.pos],
            )),
            d.setBreaks(h, u(a, !0)));
        }
      }
      return m;
    },
  );
  M(
    a,
    'Series/TreeUtilities.js',
    [a['Core/Color/Color.js'], a['Core/Utilities.js']],
    function (a, A) {
      function x(a, r) {
        var m = r.before;
        const q = r.idRoot,
          h = r.mapIdToNode[q],
          g = r.points[a.i],
          d = (g && g.options) || {},
          k = [];
        let y = 0;
        a.levelDynamic = a.level - (!1 !== r.levelIsConstant ? 0 : h.level);
        a.name = u(g && g.name, '');
        a.visible = q === a.id || !0 === r.visible;
        'function' === typeof m && (a = m(a, r));
        a.children.forEach((d, g) => {
          const f = H({}, r);
          H(f, { index: g, siblings: a.children.length, visible: a.visible });
          d = x(d, f);
          k.push(d);
          d.visible && (y += d.val);
        });
        m = u(d.value, y);
        a.visible = 0 <= m && (0 < y || a.visible);
        a.children = k;
        a.childrenTotal = y;
        a.isLeaf = a.visible && !y;
        a.val = m;
        return a;
      }
      const {
        extend: H,
        isArray: C,
        isNumber: z,
        isObject: D,
        merge: B,
        pick: u,
      } = A;
      return {
        getColor: function (q, r) {
          const m = r.index;
          var v = r.mapOptionsToLevel;
          const h = r.parentColor,
            g = r.parentColorIndex,
            d = r.series;
          var k = r.colors;
          const y = r.siblings;
          var x = d.points,
            z = d.chart.options.chart;
          let f;
          var p;
          let t;
          if (q) {
            x = x[q.i];
            q = v[q.level] || {};
            if ((v = x && q.colorByPoint)) {
              f = x.index % (k ? k.length : z.colorCount);
              var n = k && k[f];
            }
            if (!d.chart.styledMode) {
              k = x && x.options.color;
              z = q && q.color;
              if ((p = h))
                p =
                  (p = q && q.colorVariation) &&
                  'brightness' === p.key &&
                  m &&
                  y
                    ? a
                        .parse(h)
                        .brighten((m / y) * p.to)
                        .get()
                    : h;
              p = u(k, z, n, p, d.color);
            }
            t = u(
              x && x.options.colorIndex,
              q && q.colorIndex,
              f,
              g,
              r.colorIndex,
            );
          }
          return { color: p, colorIndex: t };
        },
        getLevelOptions: function (a) {
          let q = {},
            m,
            v,
            h;
          if (D(a)) {
            h = z(a.from) ? a.from : 1;
            var g = a.levels;
            v = {};
            m = D(a.defaults) ? a.defaults : {};
            C(g) &&
              (v = g.reduce((a, g) => {
                let d, k;
                D(g) &&
                  z(g.level) &&
                  ((k = B({}, g)),
                  (d = u(k.levelIsConstant, m.levelIsConstant)),
                  delete k.levelIsConstant,
                  delete k.level,
                  (g = g.level + (d ? 0 : h - 1)),
                  D(a[g]) ? B(!0, a[g], k) : (a[g] = k));
                return a;
              }, {}));
            g = z(a.to) ? a.to : 1;
            for (a = 0; a <= g; a++) q[a] = B({}, m, D(v[a]) ? v[a] : {});
          }
          return q;
        },
        setTreeValues: x,
        updateRootId: function (a) {
          if (D(a)) {
            var q = D(a.options) ? a.options : {};
            q = u(a.rootNode, q.rootId, '');
            D(a.userOptions) && (a.userOptions.rootId = q);
            a.rootNode = q;
          }
          return q;
        },
      };
    },
  );
  M(
    a,
    'Core/Axis/TreeGrid/TreeGridAxis.js',
    [
      a['Core/Axis/BrokenAxis.js'],
      a['Core/Axis/GridAxis.js'],
      a['Gantt/Tree.js'],
      a['Core/Axis/TreeGrid/TreeGridTick.js'],
      a['Series/TreeUtilities.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H, C, z) {
      function x(a, b) {
        const c = a.collapseEnd || 0;
        a = a.collapseStart || 0;
        c >= b && (a -= 0.5);
        return { from: a, to: c, showPoints: !1 };
      }
      function B(a, b, c) {
        const d = [],
          e = [],
          f = {},
          h = 'boolean' === typeof b ? b : !1;
        let k = {},
          m = -1;
        a = G.getTree(a, {
          after: function (a) {
            a = k[a.pos];
            let b = 0,
              c = 0;
            a.children.forEach(function (a) {
              c += (a.descendants || 0) + 1;
              b = Math.max((a.height || 0) + 1, b);
            });
            a.descendants = c;
            a.height = b;
            a.collapsed && e.push(a);
          },
          before: function (a) {
            const b = y(a.data, !0) ? a.data : {},
              c = K(b.name) ? b.name : '';
            var e = f[a.parent];
            e = y(e, !0) ? k[e.pos] : null;
            var l = function (a) {
              return a.name === c;
            };
            let n;
            h && y(e, !0) && (n = g(e.children, l))
              ? ((l = n.pos), n.nodes.push(a))
              : (l = m++);
            k[l] ||
              ((k[l] = n =
                {
                  depth: e ? e.depth + 1 : 0,
                  name: c,
                  id: b.id,
                  nodes: [a],
                  children: [],
                  pos: l,
                }),
              -1 !== l && d.push(c),
              y(e, !0) && e.children.push(n));
            K(a.id) && (f[a.id] = a);
            n && !0 === b.collapsed && (n.collapsed = !0);
            a.pos = l;
          },
        });
        k = (function (a, b) {
          const c = function (a, d, e) {
            let f = d + (-1 === d ? 0 : b - 1);
            const g = (f - d) / 2,
              h = d + g;
            a.nodes.forEach(function (a) {
              const b = a.data;
              y(b, !0) &&
                ((b.y = d + (b.seriesIndex || 0)), delete b.seriesIndex);
              a.pos = h;
            });
            e[h] = a;
            a.pos = h;
            a.tickmarkOffset = g + 0.5;
            a.collapseStart = f + 0.5;
            a.children.forEach(function (a) {
              c(a, f + 1, e);
              f = (a.collapseEnd || 0) - 0.5;
            });
            a.collapseEnd = f + 0.5;
            return e;
          };
          return c(a['-1'], -1, {});
        })(k, c);
        return {
          categories: d,
          mapOfIdToNode: f,
          mapOfPosToGridNode: k,
          collapsedNodes: e,
          tree: a,
        };
      }
      function u(a) {
        a.target.axes
          .filter(function (a) {
            return 'treegrid' === a.options.type;
          })
          .forEach(function (b) {
            var c = b.options || {};
            const d = c.labels,
              e = c.uniqueNames;
            c = c.max;
            let f = 0,
              g;
            if (
              !b.treeGrid.mapOfPosToGridNode ||
              b.series.some(function (a) {
                return !a.hasRendered || a.isDirtyData || a.isDirty;
              })
            ) {
              g = b.series.reduce(function (a, b) {
                b.visible &&
                  ((b.options.data || []).forEach(function (c) {
                    b.options.keys &&
                      b.options.keys.length &&
                      ((c = b.pointClass.prototype.optionsToObject.call(
                        { series: b },
                        c,
                      )),
                      b.pointClass.setGanttPointAliases(c));
                    y(c, !0) && ((c.seriesIndex = f), a.push(c));
                  }),
                  !0 === e && f++);
                return a;
              }, []);
              if (c && g.length < c)
                for (let a = g.length; a <= c; a++)
                  g.push({ name: a + '\u200b' });
              c = B(g, e || !1, !0 === e ? f : 1);
              b.categories = c.categories;
              b.treeGrid.mapOfPosToGridNode = c.mapOfPosToGridNode;
              b.hasNames = !0;
              b.treeGrid.tree = c.tree;
              b.series.forEach(function (a) {
                const b = (a.options.data || []).map(function (b) {
                  k(b) &&
                    a.options.keys &&
                    a.options.keys.length &&
                    g.forEach(function (a) {
                      0 <= b.indexOf(a.x) && 0 <= b.indexOf(a.x2) && (b = a);
                    });
                  return y(b, !0) ? L(b) : b;
                });
                a.visible && a.setData(b, !1);
              });
              b.treeGrid.mapOptionsToLevel = v({
                defaults: d,
                from: 1,
                levels: d && d.levels,
                to: b.treeGrid.tree && b.treeGrid.tree.height,
              });
              'beforeRender' === a.type &&
                (b.treeGrid.collapsedNodes = c.collapsedNodes);
            }
          });
      }
      function q(a, b) {
        var c = this.treeGrid.mapOptionsToLevel || {};
        const d = this.ticks;
        let e = d[b],
          f,
          g;
        'treegrid' === this.options.type && this.treeGrid.mapOfPosToGridNode
          ? ((g = this.treeGrid.mapOfPosToGridNode[b]),
            (c = c[g.depth]) && (f = { labels: c }),
            !e && n
              ? (d[b] = new n(this, b, void 0, void 0, {
                  category: g.name,
                  tickmarkOffset: g.tickmarkOffset,
                  options: f,
                }))
              : ((e.parameters.category = g.name),
                (e.options = f),
                e.addLabel()))
          : a.apply(this, Array.prototype.slice.call(arguments, 1));
      }
      function r(a, b, c, d) {
        const e = this,
          f = 'treegrid' === c.type;
        e.treeGrid || (e.treeGrid = new w(e));
        f &&
          (h(b, 'beforeRender', u),
          h(b, 'beforeRedraw', u),
          h(b, 'addSeries', function (a) {
            a.options.data &&
              ((a = B(a.options.data, c.uniqueNames || !1, 1)),
              (e.treeGrid.collapsedNodes = (
                e.treeGrid.collapsedNodes || []
              ).concat(a.collapsedNodes)));
          }),
          h(e, 'foundExtremes', function () {
            e.treeGrid.collapsedNodes &&
              e.treeGrid.collapsedNodes.forEach(function (a) {
                const b = e.treeGrid.collapse(a);
                e.brokenAxis &&
                  (e.brokenAxis.setBreaks(b, !1),
                  e.treeGrid.collapsedNodes &&
                    (e.treeGrid.collapsedNodes =
                      e.treeGrid.collapsedNodes.filter(
                        (b) =>
                          a.collapseStart !== b.collapseStart ||
                          a.collapseEnd !== b.collapseEnd,
                      )));
              });
          }),
          h(e, 'afterBreaks', function () {
            'yAxis' === e.coll &&
              !e.staticScale &&
              e.chart.options.chart.height &&
              (e.isDirty = !0);
          }),
          (c = L(
            {
              grid: { enabled: !0 },
              labels: {
                align: 'left',
                levels: [
                  { level: void 0 },
                  { level: 1, style: { fontWeight: 'bold' } },
                ],
                symbol: {
                  type: 'triangle',
                  x: -5,
                  y: -5,
                  height: 10,
                  width: 10,
                  padding: 5,
                },
              },
              uniqueNames: !1,
            },
            c,
            { reversed: !0, grid: { columns: void 0 } },
          )));
        a.apply(e, [b, c, d]);
        f && ((e.hasNames = !0), (e.options.showLastLabel = !0));
      }
      function m(a) {
        const b = this.options;
        'treegrid' === b.type
          ? ((this.min = f(this.userMin, b.min, this.dataMin)),
            (this.max = f(this.userMax, b.max, this.dataMax)),
            d(this, 'foundExtremes'),
            this.setAxisTranslation(),
            (this.tickmarkOffset = 0.5),
            (this.tickInterval = 1),
            (this.tickPositions = this.treeGrid.mapOfPosToGridNode
              ? this.treeGrid.getTickPositions()
              : []))
          : a.apply(this, Array.prototype.slice.call(arguments, 1));
      }
      const { getLevelOptions: v } = C,
        {
          addEvent: h,
          find: g,
          fireEvent: d,
          isArray: k,
          isObject: y,
          isString: K,
          merge: L,
          pick: f,
          wrap: p,
        } = z,
        t = [];
      let n;
      class w {
        static compose(d, b, c, f) {
          if (z.pushUnique(t, d)) {
            -1 === d.keepProps.indexOf('treeGrid') &&
              d.keepProps.push('treeGrid');
            const a = d.prototype;
            p(a, 'generateTick', q);
            p(a, 'init', r);
            p(a, 'setTickInterval', m);
            a.utils = { getNode: G.getNode };
          }
          z.pushUnique(t, f) && (n || (n = f));
          A.compose(d, b, f);
          a.compose(d, c);
          H.compose(f);
          return d;
        }
        constructor(a) {
          this.axis = a;
        }
        setCollapsedStatus(a) {
          const b = this.axis,
            c = b.chart;
          b.series.forEach(function (b) {
            const d = b.options.data;
            if (a.id && d) {
              const e = c.get(a.id);
              b = d[b.data.indexOf(e)];
              e &&
                b &&
                ((e.collapsed = a.collapsed), (b.collapsed = a.collapsed));
            }
          });
        }
        collapse(a) {
          const b = this.axis,
            c = b.options.breaks || [],
            d = x(a, b.max);
          c.push(d);
          a.collapsed = !0;
          b.treeGrid.setCollapsedStatus(a);
          return c;
        }
        expand(a) {
          const b = this.axis,
            c = b.options.breaks || [],
            d = x(a, b.max);
          a.collapsed = !1;
          b.treeGrid.setCollapsedStatus(a);
          return c.reduce(function (a, b) {
            (b.to === d.to && b.from === d.from) || a.push(b);
            return a;
          }, []);
        }
        getTickPositions() {
          const a = this.axis,
            b = Math.floor(a.min / a.tickInterval) * a.tickInterval,
            c = Math.ceil(a.max / a.tickInterval) * a.tickInterval;
          return Object.keys(a.treeGrid.mapOfPosToGridNode || {}).reduce(
            function (d, e) {
              e = +e;
              !(e >= b && e <= c) ||
                (a.brokenAxis && a.brokenAxis.isInAnyBreak(e)) ||
                d.push(e);
              return d;
            },
            [],
          );
        }
        isCollapsed(a) {
          const b = this.axis,
            c = b.options.breaks || [],
            d = x(a, b.max);
          return c.some(function (a) {
            return a.from === d.from && a.to === d.to;
          });
        }
        toggleCollapse(a) {
          return this.isCollapsed(a) ? this.expand(a) : this.collapse(a);
        }
      }
      return w;
    },
  );
  M(
    a,
    'Extensions/StaticScale.js',
    [a['Core/Axis/Axis.js'], a['Core/Chart/Chart.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      const { addEvent: x, defined: C, isNumber: z, pick: D } = G;
      x(a, 'afterSetOptions', function () {
        const a = this.chart.options.chart;
        !this.horiz &&
          z(this.options.staticScale) &&
          (!a.height ||
            (a.scrollablePlotArea && a.scrollablePlotArea.minHeight)) &&
          (this.staticScale = this.options.staticScale);
      });
      A.prototype.adjustHeight = function () {
        'adjustHeight' !== this.redrawTrigger &&
          ((this.axes || []).forEach(function (a) {
            let u = a.chart,
              q = !!u.initiatedScale && u.options.animation;
            var r = a.options.staticScale;
            let m;
            a.staticScale &&
              C(a.min) &&
              ((m =
                D(
                  a.brokenAxis && a.brokenAxis.unitLength,
                  a.max + a.tickInterval - a.min,
                ) * r),
              (m = Math.max(m, r)),
              (r = m - u.plotHeight),
              !u.scrollablePixelsY &&
                1 <= Math.abs(r) &&
                ((u.plotHeight = m),
                (u.redrawTrigger = 'adjustHeight'),
                u.setSize(void 0, u.chartHeight + r, q)),
              a.series.forEach(function (a) {
                (a = a.sharedClipKey && u.sharedClips[a.sharedClipKey]) &&
                  a.attr(
                    u.inverted
                      ? { width: u.plotHeight }
                      : { height: u.plotHeight },
                  );
              }));
          }),
          (this.initiatedScale = !0));
        this.redrawTrigger = null;
      };
      x(A, 'render', A.prototype.adjustHeight);
    },
  );
  M(
    a,
    'Gantt/Connection.js',
    [
      a['Core/Defaults.js'],
      a['Core/Globals.js'],
      a['Core/Series/Point.js'],
      a['Core/Utilities.js'],
    ],
    function (a, A, G, H) {
      function x(a) {
        var d = a.shapeArgs;
        return d
          ? {
              xMin: d.x || 0,
              xMax: (d.x || 0) + (d.width || 0),
              yMin: d.y || 0,
              yMax: (d.y || 0) + (d.height || 0),
            }
          : (d = a.graphic && a.graphic.getBBox())
            ? {
                xMin: a.plotX - d.width / 2,
                xMax: a.plotX + d.width / 2,
                yMin: a.plotY - d.height / 2,
                yMax: a.plotY + d.height / 2,
              }
            : null;
      }
      ({ defaultOptions: a } = a);
      const { defined: z, error: D, extend: B, merge: u, objectEach: q } = H;
      ('');
      const r = A.deg2rad,
        m = Math.max,
        v = Math.min;
      B(a, {
        connectors: {
          type: 'straight',
          radius: 0,
          lineWidth: 1,
          marker: {
            enabled: !1,
            align: 'center',
            verticalAlign: 'middle',
            inside: !1,
            lineWidth: 1,
          },
          startMarker: { symbol: 'diamond' },
          endMarker: { symbol: 'arrow-filled' },
        },
      });
      class h {
        constructor(a, d, h) {
          this.toPoint =
            this.pathfinder =
            this.graphics =
            this.fromPoint =
            this.chart =
              void 0;
          this.init(a, d, h);
        }
        init(a, d, h) {
          this.fromPoint = a;
          this.toPoint = d;
          this.options = h;
          this.chart = a.series.chart;
          this.pathfinder = this.chart.pathfinder;
        }
        renderPath(a, d, h) {
          let g = this.chart,
            k = g.styledMode,
            m = g.pathfinder,
            f = !g.options.chart.forExport && !1 !== h,
            p = this.graphics && this.graphics.path;
          m.group ||
            (m.group = g.renderer
              .g()
              .addClass('highcharts-pathfinder-group')
              .attr({ zIndex: -1 })
              .add(g.seriesGroup));
          m.group.translate(g.plotLeft, g.plotTop);
          (p && p.renderer) ||
            ((p = g.renderer.path().add(m.group)), k || p.attr({ opacity: 0 }));
          p.attr(d);
          a = { d: a };
          k || (a.opacity = 1);
          p[f ? 'animate' : 'attr'](a, h);
          this.graphics = this.graphics || {};
          this.graphics.path = p;
        }
        addMarker(a, d, h) {
          var g = this.fromPoint.series.chart;
          let k = g.pathfinder;
          g = g.renderer;
          let m = 'start' === a ? this.fromPoint : this.toPoint;
          var f = m.getPathfinderAnchorPoint(d);
          let p, q;
          d.enabled &&
            (((h = 'start' === a ? h[1] : h[h.length - 2]) && 'M' === h[0]) ||
              'L' === h[0]) &&
            ((h = { x: h[1], y: h[2] }),
            (h = m.getRadiansToVector(h, f)),
            (f = m.getMarkerVector(h, d.radius, f)),
            (h = -h / r),
            d.width && d.height
              ? ((p = d.width), (q = d.height))
              : (p = q = 2 * d.radius),
            (this.graphics = this.graphics || {}),
            (f = {
              x: f.x - p / 2,
              y: f.y - q / 2,
              width: p,
              height: q,
              rotation: h,
              rotationOriginX: f.x,
              rotationOriginY: f.y,
            }),
            this.graphics[a]
              ? this.graphics[a].animate(f)
              : ((this.graphics[a] = g
                  .symbol(d.symbol)
                  .addClass(
                    'highcharts-point-connecting-path-' +
                      a +
                      '-marker highcharts-color-' +
                      this.fromPoint.colorIndex,
                  )
                  .attr(f)
                  .add(k.group)),
                g.styledMode ||
                  this.graphics[a]
                    .attr({
                      fill: d.color || this.fromPoint.color,
                      stroke: d.lineColor,
                      'stroke-width': d.lineWidth,
                      opacity: 0,
                    })
                    .animate({ opacity: 1 }, m.series.options.animation)));
        }
        getPath(a) {
          let d = this.pathfinder,
            g = this.chart,
            h = d.algorithms[a.type],
            m = d.chartObstacles;
          if ('function' !== typeof h)
            return (
              D('"' + a.type + '" is not a Pathfinder algorithm.'),
              { path: [], obstacles: [] }
            );
          h.requiresObstacles &&
            !m &&
            ((m = d.chartObstacles = d.getChartObstacles(a)),
            (g.options.connectors.algorithmMargin = a.algorithmMargin),
            (d.chartObstacleMetrics = d.getObstacleMetrics(m)));
          return h(
            this.fromPoint.getPathfinderAnchorPoint(a.startMarker),
            this.toPoint.getPathfinderAnchorPoint(a.endMarker),
            u(
              {
                chartObstacles: m,
                lineObstacles: d.lineObstacles || [],
                obstacleMetrics: d.chartObstacleMetrics,
                hardBounds: {
                  xMin: 0,
                  xMax: g.plotWidth,
                  yMin: 0,
                  yMax: g.plotHeight,
                },
                obstacleOptions: { margin: a.algorithmMargin },
                startDirectionX: d.getAlgorithmStartDirection(a.startMarker),
              },
              a,
            ),
          );
        }
        render() {
          var a = this.fromPoint;
          let d = a.series;
          var h = d.chart;
          let q = h.pathfinder,
            r = u(
              h.options.connectors,
              d.options.connectors,
              a.options.connectors,
              this.options,
            ),
            x = {};
          h.styledMode ||
            ((x.stroke = r.lineColor || a.color),
            (x['stroke-width'] = r.lineWidth),
            r.dashStyle && (x.dashstyle = r.dashStyle));
          x['class'] =
            'highcharts-point-connecting-path highcharts-color-' + a.colorIndex;
          r = u(x, r);
          z(r.marker.radius) ||
            (r.marker.radius = v(
              m(Math.ceil((r.algorithmMargin || 8) / 2) - 1, 1),
              5,
            ));
          a = this.getPath(r);
          h = a.path;
          a.obstacles &&
            ((q.lineObstacles = q.lineObstacles || []),
            (q.lineObstacles = q.lineObstacles.concat(a.obstacles)));
          this.renderPath(h, x, d.options.animation);
          this.addMarker('start', u(r.marker, r.startMarker), h);
          this.addMarker('end', u(r.marker, r.endMarker), h);
        }
        destroy() {
          this.graphics &&
            (q(this.graphics, function (a) {
              a.destroy();
            }),
            delete this.graphics);
        }
      }
      A.Connection = h;
      B(G.prototype, {
        getPathfinderAnchorPoint: function (a) {
          let d = x(this),
            g,
            h;
          switch (a.align) {
            case 'right':
              g = 'xMax';
              break;
            case 'left':
              g = 'xMin';
          }
          switch (a.verticalAlign) {
            case 'top':
              h = 'yMin';
              break;
            case 'bottom':
              h = 'yMax';
          }
          return {
            x: g ? d[g] : (d.xMin + d.xMax) / 2,
            y: h ? d[h] : (d.yMin + d.yMax) / 2,
          };
        },
        getRadiansToVector: function (a, d) {
          let g;
          z(d) ||
            ((g = x(this)) &&
              (d = { x: (g.xMin + g.xMax) / 2, y: (g.yMin + g.yMax) / 2 }));
          return Math.atan2(d.y - a.y, a.x - d.x);
        },
        getMarkerVector: function (a, d, h) {
          var g = 2 * Math.PI,
            k = x(this),
            m = k.xMax - k.xMin;
          let f = k.yMax - k.yMin,
            p = Math.atan2(f, m),
            q = !1;
          m /= 2;
          let n = f / 2,
            r = k.xMin + m;
          k = k.yMin + n;
          var e = r,
            b = k;
          let c = 1,
            l = 1;
          for (; a < -Math.PI; ) a += g;
          for (; a > Math.PI; ) a -= g;
          g = Math.tan(a);
          a > -p && a <= p
            ? ((l = -1), (q = !0))
            : a > p && a <= Math.PI - p
              ? (l = -1)
              : a > Math.PI - p || a <= -(Math.PI - p)
                ? ((c = -1), (q = !0))
                : (c = -1);
          q
            ? ((e += c * m), (b += l * m * g))
            : ((e += (f / (2 * g)) * c), (b += l * n));
          h.x !== r && (e = h.x);
          h.y !== k && (b = h.y);
          return { x: e + d * Math.cos(a), y: b - d * Math.sin(a) };
        },
      });
      return h;
    },
  );
  M(a, 'Series/PathUtilities.js', [], function () {
    function a(a, x) {
      const A = [];
      for (let D = 0; D < a.length; D++) {
        const B = a[D][1],
          u = a[D][2];
        if ('number' === typeof B && 'number' === typeof u)
          if (0 === D) A.push(['M', B, u]);
          else if (D === a.length - 1) A.push(['L', B, u]);
          else if (x) {
            var C = a[D - 1],
              z = a[D + 1];
            if (C && z) {
              const a = C[1];
              C = C[2];
              const r = z[1];
              z = z[2];
              if (
                'number' === typeof a &&
                'number' === typeof r &&
                'number' === typeof C &&
                'number' === typeof z &&
                a !== r &&
                C !== z
              ) {
                const m = a < r ? 1 : -1,
                  q = C < z ? 1 : -1;
                A.push(
                  [
                    'L',
                    B - m * Math.min(Math.abs(B - a), x),
                    u - q * Math.min(Math.abs(u - C), x),
                  ],
                  [
                    'C',
                    B,
                    u,
                    B,
                    u,
                    B + m * Math.min(Math.abs(B - r), x),
                    u + q * Math.min(Math.abs(u - z), x),
                  ],
                );
              }
            }
          } else A.push(['L', B, u]);
      }
      return A;
    }
    return {
      applyRadius: a,
      getLinkPath: {
        default: function (x) {
          const {
            x1: A,
            y1: H,
            x2: C,
            y2: z,
            width: D = 0,
            inverted: B = !1,
            radius: u,
            parentVisible: q,
          } = x;
          x = [
            ['M', A, H],
            ['L', A, H],
            ['C', A, H, A, z, A, z],
            ['L', A, z],
            ['C', A, H, A, z, A, z],
            ['L', A, z],
          ];
          return q
            ? a(
                [
                  ['M', A, H],
                  ['L', A + D * (B ? -0.5 : 0.5), H],
                  ['L', A + D * (B ? -0.5 : 0.5), z],
                  ['L', C, z],
                ],
                u,
              )
            : x;
        },
        straight: function (a) {
          const {
            x1: x,
            y1: A,
            x2: C,
            y2: z,
            width: D = 0,
            inverted: B = !1,
            parentVisible: u,
          } = a;
          return u
            ? [
                ['M', x, A],
                ['L', x + D * (B ? -1 : 1), z],
                ['L', C, z],
              ]
            : [
                ['M', x, A],
                ['L', x, z],
                ['L', x, z],
              ];
        },
        curved: function (a) {
          const {
            x1: x,
            y1: A,
            x2: C,
            y2: z,
            offset: D = 0,
            width: B = 0,
            inverted: u = !1,
            parentVisible: q,
          } = a;
          return q
            ? [
                ['M', x, A],
                [
                  'C',
                  x + D,
                  A,
                  x - D + B * (u ? -1 : 1),
                  z,
                  x + B * (u ? -1 : 1),
                  z,
                ],
                ['L', C, z],
              ]
            : [
                ['M', x, A],
                ['C', x, A, x, z, x, z],
                ['L', C, z],
              ];
        },
      },
    };
  });
  M(
    a,
    'Gantt/PathfinderAlgorithms.js',
    [a['Series/PathUtilities.js'], a['Core/Utilities.js']],
    function (a, A) {
      function x(a, q, h) {
        h = h || 0;
        let g = a.length - 1;
        q -= 1e-7;
        let d, k;
        for (; h <= g; )
          if (((d = (g + h) >> 1), (k = q - a[d].xMin), 0 < k)) h = d + 1;
          else if (0 > k) g = d - 1;
          else return d;
        return 0 < h ? h - 1 : 0;
      }
      function H(a, q) {
        let h = x(a, q.x + 1) + 1;
        for (; h--; ) {
          var g;
          if ((g = a[h].xMax >= q.x))
            ((g = a[h]),
              (g =
                q.x <= g.xMax &&
                q.x >= g.xMin &&
                q.y <= g.yMax &&
                q.y >= g.yMin));
          if (g) return h;
        }
        return -1;
      }
      function C(a) {
        const m = [];
        if (a.length) {
          m.push(['M', a[0].start.x, a[0].start.y]);
          for (let h = 0; h < a.length; ++h)
            m.push(['L', a[h].end.x, a[h].end.y]);
        }
        return m;
      }
      function z(a, q) {
        a.yMin = u(a.yMin, q.yMin);
        a.yMax = B(a.yMax, q.yMax);
        a.xMin = u(a.xMin, q.xMin);
        a.xMax = B(a.xMax, q.xMax);
      }
      const { pick: D } = A,
        { min: B, max: u, abs: q } = Math;
      A = function (m, r, h) {
        function g(a, d, e, b, c) {
          a = { x: a.x, y: a.y };
          a[d] = e[b || d] + (c || 0);
          return a;
        }
        function d(a, d, e) {
          const b = q(d[e] - a[e + 'Min']) > q(d[e] - a[e + 'Max']);
          return g(d, e, a, e + (b ? 'Max' : 'Min'), b ? 1 : -1);
        }
        let k = [];
        var u = D(h.startDirectionX, q(r.x - m.x) > q(r.y - m.y)) ? 'x' : 'y',
          v = h.chartObstacles;
        let x = H(v, m);
        var f = H(v, r);
        let p;
        if (-1 < f) {
          var t = v[f];
          f = d(t, r, u);
          t = { start: f, end: r };
          p = f;
        } else p = r;
        -1 < x &&
          ((v = v[x]),
          (f = d(v, m, u)),
          k.push({ start: m, end: f }),
          f[u] >= m[u] === f[u] >= p[u] &&
            ((u = 'y' === u ? 'x' : 'y'),
            (r = m[u] < r[u]),
            k.push({
              start: f,
              end: g(f, u, v, u + (r ? 'Max' : 'Min'), r ? 1 : -1),
            }),
            (u = 'y' === u ? 'x' : 'y')));
        m = k.length ? k[k.length - 1].end : m;
        f = g(m, u, p);
        k.push({ start: m, end: f });
        u = g(f, 'y' === u ? 'x' : 'y', p);
        k.push({ start: f, end: u });
        k.push(t);
        return { path: a.applyRadius(C(k), h.radius), obstacles: k };
      };
      A.requiresObstacles = !0;
      const r = function (a, r, h) {
        function g(a, b, c) {
          let d,
            e,
            f,
            g,
            h,
            k = a.x < b.x ? 1 : -1;
          a.x < b.x ? ((d = a), (e = b)) : ((d = b), (e = a));
          a.y < b.y ? ((g = a), (f = b)) : ((g = b), (f = a));
          for (
            h = 0 > k ? B(x(l, e.x), l.length - 1) : 0;
            l[h] &&
            ((0 < k && l[h].xMin <= e.x) || (0 > k && l[h].xMax >= d.x));
          ) {
            if (
              l[h].xMin <= e.x &&
              l[h].xMax >= d.x &&
              l[h].yMin <= f.y &&
              l[h].yMax >= g.y
            )
              return c
                ? {
                    y: a.y,
                    x: a.x < b.x ? l[h].xMin - 1 : l[h].xMax + 1,
                    obstacle: l[h],
                  }
                : {
                    x: a.x,
                    y: a.y < b.y ? l[h].yMin - 1 : l[h].yMax + 1,
                    obstacle: l[h],
                  };
            h += k;
          }
          return b;
        }
        function d(a, b, c, d, e) {
          var f = e.soft,
            h = e.hard;
          let l = d ? 'x' : 'y',
            k = { x: b.x, y: b.y },
            m = { x: b.x, y: b.y };
          e = a[l + 'Max'] >= f[l + 'Max'];
          f = a[l + 'Min'] <= f[l + 'Min'];
          let n = a[l + 'Max'] >= h[l + 'Max'];
          h = a[l + 'Min'] <= h[l + 'Min'];
          let p = q(a[l + 'Min'] - b[l]),
            r = q(a[l + 'Max'] - b[l]);
          c = 10 > q(p - r) ? b[l] < c[l] : r < p;
          m[l] = a[l + 'Min'];
          k[l] = a[l + 'Max'];
          a = g(b, m, d)[l] !== m[l];
          b = g(b, k, d)[l] !== k[l];
          c = a ? (b ? c : !0) : b ? !1 : c;
          c = f ? (e ? c : !0) : e ? !1 : c;
          return h ? (n ? c : !0) : n ? !1 : c;
        }
        function k(a, f, m) {
          if (a.x === f.x && a.y === f.y) return [];
          var n = m ? 'x' : 'y';
          let p,
            q,
            r,
            v = h.obstacleOptions.margin;
          var x = {
            soft: { xMin: w, xMax: e, yMin: b, yMax: c },
            hard: h.hardBounds,
          };
          p = H(l, a);
          -1 < p
            ? ((p = l[p]),
              (x = d(p, a, f, m, x)),
              z(p, h.hardBounds),
              (r = m
                ? { y: a.y, x: p[x ? 'xMax' : 'xMin'] + (x ? 1 : -1) }
                : { x: a.x, y: p[x ? 'yMax' : 'yMin'] + (x ? 1 : -1) }),
              (q = H(l, r)),
              -1 < q &&
                ((q = l[q]),
                z(q, h.hardBounds),
                (r[n] = x
                  ? u(p[n + 'Max'] - v + 1, (q[n + 'Min'] + p[n + 'Max']) / 2)
                  : B(p[n + 'Min'] + v - 1, (q[n + 'Max'] + p[n + 'Min']) / 2)),
                a.x === r.x && a.y === r.y
                  ? (t &&
                      (r[n] = x
                        ? u(p[n + 'Max'], q[n + 'Max']) + 1
                        : B(p[n + 'Min'], q[n + 'Min']) - 1),
                    (t = !t))
                  : (t = !1)),
              (a = [{ start: a, end: r }]))
            : ((n = g(a, { x: m ? f.x : a.x, y: m ? a.y : f.y }, m)),
              (a = [{ start: a, end: { x: n.x, y: n.y } }]),
              n[m ? 'x' : 'y'] !== f[m ? 'x' : 'y'] &&
                ((x = d(n.obstacle, n, f, !m, x)),
                z(n.obstacle, h.hardBounds),
                (x = {
                  x: m ? n.x : n.obstacle[x ? 'xMax' : 'xMin'] + (x ? 1 : -1),
                  y: m ? n.obstacle[x ? 'yMax' : 'yMin'] + (x ? 1 : -1) : n.y,
                }),
                (m = !m),
                (a = a.concat(k({ x: n.x, y: n.y }, x, m)))));
          return (a = a.concat(k(a[a.length - 1].end, f, !m)));
        }
        function m(a, b, c) {
          const e =
            B(a.xMax - b.x, b.x - a.xMin) < B(a.yMax - b.y, b.y - a.yMin);
          c = d(a, b, c, e, { soft: h.hardBounds, hard: h.hardBounds });
          return e
            ? { y: b.y, x: a[c ? 'xMax' : 'xMin'] + (c ? 1 : -1) }
            : { x: b.x, y: a[c ? 'yMax' : 'yMin'] + (c ? 1 : -1) };
        }
        let v = D(h.startDirectionX, q(r.x - a.x) > q(r.y - a.y)),
          A = v ? 'x' : 'y';
        let f,
          p = [],
          t = !1;
        var n = h.obstacleMetrics;
        let w = B(a.x, r.x) - n.maxWidth - 10,
          e = u(a.x, r.x) + n.maxWidth + 10,
          b = B(a.y, r.y) - n.maxHeight - 10,
          c = u(a.y, r.y) + n.maxHeight + 10,
          l = h.chartObstacles;
        var I = x(l, w);
        n = x(l, e);
        l = l.slice(I, n + 1);
        -1 < (n = H(l, r)) &&
          ((f = m(l[n], r, a)), p.push({ end: r, start: f }), (r = f));
        for (; -1 < (n = H(l, r)); )
          ((I = 0 > r[A] - a[A]),
            (f = { x: r.x, y: r.y }),
            (f[A] = l[n][I ? A + 'Max' : A + 'Min'] + (I ? 1 : -1)),
            p.push({ end: r, start: f }),
            (r = f));
        a = k(a, r, v);
        a = a.concat(p.reverse());
        return { path: C(a), obstacles: a };
      };
      r.requiresObstacles = !0;
      return {
        fastAvoid: r,
        straight: function (a, q) {
          return {
            path: [
              ['M', a.x, a.y],
              ['L', q.x, q.y],
            ],
            obstacles: [{ start: a, end: q }],
          };
        },
        simpleConnect: A,
      };
    },
  );
  M(
    a,
    'Gantt/Pathfinder.js',
    [
      a['Gantt/Connection.js'],
      a['Core/Chart/Chart.js'],
      a['Core/Defaults.js'],
      a['Core/Globals.js'],
      a['Core/Series/Point.js'],
      a['Core/Utilities.js'],
      a['Gantt/PathfinderAlgorithms.js'],
    ],
    function (a, A, G, H, C, z, D) {
      function x(a) {
        var d = a.shapeArgs;
        return d
          ? {
              xMin: d.x || 0,
              xMax: (d.x || 0) + (d.width || 0),
              yMin: d.y || 0,
              yMax: (d.y || 0) + (d.height || 0),
            }
          : (d = a.graphic && a.graphic.getBBox())
            ? {
                xMin: a.plotX - d.width / 2,
                xMax: a.plotX + d.width / 2,
                yMin: a.plotY - d.height / 2,
                yMax: a.plotY + d.height / 2,
              }
            : null;
      }
      function u(a) {
        let f = a.length,
          g = 0,
          h,
          k,
          e = [],
          b = function (a, e, f) {
            f = d(f, 10);
            const c = a.yMax + f > e.yMin - f && a.yMin - f < e.yMax + f,
              g = a.xMax + f > e.xMin - f && a.xMin - f < e.xMax + f,
              h = c
                ? a.xMin > e.xMax
                  ? a.xMin - e.xMax
                  : e.xMin - a.xMax
                : Infinity,
              l = g
                ? a.yMin > e.yMax
                  ? a.yMin - e.yMax
                  : e.yMin - a.yMax
                : Infinity;
            return g && c
              ? f
                ? b(a, e, Math.floor(f / 2))
                : Infinity
              : K(h, l);
          };
        for (; g < f; ++g)
          for (h = g + 1; h < f; ++h)
            ((k = b(a[g], a[h])), 80 > k && e.push(k));
        e.push(80);
        return y(
          Math.floor(
            e.sort(function (a, b) {
              return a - b;
            })[Math.floor(e.length / 10)] /
              2 -
              1,
          ),
          1,
        );
      }
      function q(a) {
        if (
          a.options.pathfinder ||
          a.series.reduce(function (a, d) {
            d.options &&
              g(
                !0,
                (d.options.connectors = d.options.connectors || {}),
                d.options.pathfinder,
              );
            return a || (d.options && d.options.pathfinder);
          }, !1)
        )
          (g(
            !0,
            (a.options.connectors = a.options.connectors || {}),
            a.options.pathfinder,
          ),
            v(
              'WARNING: Pathfinder options have been renamed. Use "chart.connectors" or "series.connectors" instead.',
            ));
      }
      ({ defaultOptions: G } = G);
      const {
        addEvent: r,
        defined: m,
        error: v,
        extend: h,
        merge: g,
        pick: d,
        splat: k,
      } = z;
      ('');
      const y = Math.max,
        K = Math.min;
      h(G, {
        connectors: {
          type: 'straight',
          radius: 0,
          lineWidth: 1,
          marker: {
            enabled: !1,
            align: 'center',
            verticalAlign: 'middle',
            inside: !1,
            lineWidth: 1,
          },
          startMarker: { symbol: 'diamond' },
          endMarker: { symbol: 'arrow-filled' },
        },
      });
      class L {
        constructor(a) {
          this.lineObstacles =
            this.group =
            this.connections =
            this.chartObstacleMetrics =
            this.chartObstacles =
            this.chart =
              void 0;
          this.init(a);
        }
        init(a) {
          this.chart = a;
          this.connections = [];
          r(a, 'redraw', function () {
            this.pathfinder.update();
          });
        }
        update(d) {
          const f = this.chart,
            g = this,
            h = g.connections;
          g.connections = [];
          f.series.forEach(function (d) {
            d.visible &&
              !d.options.isInternal &&
              d.points.forEach(function (d) {
                var b = d.options;
                b && b.dependency && (b.connect = b.dependency);
                let c;
                b = d.options && d.options.connect && k(d.options.connect);
                d.visible &&
                  !1 !== d.isInside &&
                  b &&
                  b.forEach(function (b) {
                    c = f.get('string' === typeof b ? b : b.to);
                    c instanceof C &&
                      c.series.visible &&
                      c.visible &&
                      !1 !== c.isInside &&
                      g.connections.push(
                        new a(d, c, 'string' === typeof b ? {} : b),
                      );
                  });
              });
          });
          for (
            let a = 0, d, b, c = h.length, f = g.connections.length;
            a < c;
            ++a
          ) {
            b = !1;
            const c = h[a];
            for (d = 0; d < f; ++d) {
              const a = g.connections[d];
              if (
                (c.options && c.options.type) ===
                  (a.options && a.options.type) &&
                c.fromPoint === a.fromPoint &&
                c.toPoint === a.toPoint
              ) {
                a.graphics = c.graphics;
                b = !0;
                break;
              }
            }
            b || c.destroy();
          }
          delete this.chartObstacles;
          delete this.lineObstacles;
          g.renderConnections(d);
        }
        renderConnections(a) {
          a
            ? this.chart.series.forEach(function (a) {
                const d = function () {
                  const d = a.chart.pathfinder;
                  ((d && d.connections) || []).forEach(function (d) {
                    d.fromPoint && d.fromPoint.series === a && d.render();
                  });
                  a.pathfinderRemoveRenderEvent &&
                    (a.pathfinderRemoveRenderEvent(),
                    delete a.pathfinderRemoveRenderEvent);
                };
                !1 === a.options.animation
                  ? d()
                  : (a.pathfinderRemoveRenderEvent = r(a, 'afterAnimate', d));
              })
            : this.connections.forEach(function (a) {
                a.render();
              });
        }
        getChartObstacles(a) {
          let f = [],
            g = this.chart.series,
            h = d(a.algorithmMargin, 0),
            k;
          for (let a = 0, b = g.length; a < b; ++a)
            if (g[a].visible && !g[a].options.isInternal)
              for (let b = 0, d = g[a].points.length, e, k; b < d; ++b)
                ((k = g[a].points[b]),
                  k.visible &&
                    (e = x(k)) &&
                    f.push({
                      xMin: e.xMin - h,
                      xMax: e.xMax + h,
                      yMin: e.yMin - h,
                      yMax: e.yMax + h,
                    }));
          f = f.sort(function (a, b) {
            return a.xMin - b.xMin;
          });
          m(a.algorithmMargin) ||
            ((k = a.algorithmMargin = u(f)),
            f.forEach(function (a) {
              a.xMin -= k;
              a.xMax += k;
              a.yMin -= k;
              a.yMax += k;
            }));
          return f;
        }
        getObstacleMetrics(a) {
          let d = 0,
            f = 0,
            g,
            h,
            e = a.length;
          for (; e--; )
            ((g = a[e].xMax - a[e].xMin),
              (h = a[e].yMax - a[e].yMin),
              d < g && (d = g),
              f < h && (f = h));
          return { maxHeight: f, maxWidth: d };
        }
        getAlgorithmStartDirection(a) {
          let d = 'top' !== a.verticalAlign && 'bottom' !== a.verticalAlign;
          return 'left' !== a.align && 'right' !== a.align
            ? d
              ? void 0
              : !1
            : d
              ? !0
              : void 0;
        }
      }
      L.prototype.algorithms = D;
      H.Pathfinder = L;
      h(C.prototype, {
        getPathfinderAnchorPoint: function (a) {
          let d = x(this),
            f,
            g;
          switch (a.align) {
            case 'right':
              f = 'xMax';
              break;
            case 'left':
              f = 'xMin';
          }
          switch (a.verticalAlign) {
            case 'top':
              g = 'yMin';
              break;
            case 'bottom':
              g = 'yMax';
          }
          return {
            x: f ? d[f] : (d.xMin + d.xMax) / 2,
            y: g ? d[g] : (d.yMin + d.yMax) / 2,
          };
        },
        getRadiansToVector: function (a, d) {
          let f;
          m(d) ||
            ((f = x(this)) &&
              (d = { x: (f.xMin + f.xMax) / 2, y: (f.yMin + f.yMax) / 2 }));
          return Math.atan2(d.y - a.y, a.x - d.x);
        },
        getMarkerVector: function (a, d, g) {
          var f = 2 * Math.PI,
            h = x(this),
            e = h.xMax - h.xMin;
          let b = h.yMax - h.yMin,
            c = Math.atan2(b, e),
            k = !1;
          e /= 2;
          let m = b / 2,
            p = h.xMin + e;
          h = h.yMin + m;
          var q = p,
            r = h;
          let t = 1,
            u = 1;
          for (; a < -Math.PI; ) a += f;
          for (; a > Math.PI; ) a -= f;
          f = Math.tan(a);
          a > -c && a <= c
            ? ((u = -1), (k = !0))
            : a > c && a <= Math.PI - c
              ? (u = -1)
              : a > Math.PI - c || a <= -(Math.PI - c)
                ? ((t = -1), (k = !0))
                : (t = -1);
          k
            ? ((q += t * e), (r += u * e * f))
            : ((q += (b / (2 * f)) * t), (r += u * m));
          g.x !== p && (q = g.x);
          g.y !== h && (r = g.y);
          return { x: q + d * Math.cos(a), y: r - d * Math.sin(a) };
        },
      });
      A.prototype.callbacks.push(function (a) {
        !1 !== a.options.connectors.enabled &&
          (q(a), (this.pathfinder = new L(this)), this.pathfinder.update(!0));
      });
      return L;
    },
  );
  M(
    a,
    'Series/Gantt/GanttSeries.js',
    [
      a['Core/Axis/Axis.js'],
      a['Core/Chart/Chart.js'],
      a['Series/Gantt/GanttPoint.js'],
      a['Core/Series/SeriesRegistry.js'],
      a['Core/Axis/Tick.js'],
      a['Core/Utilities.js'],
      a['Core/Axis/TreeGrid/TreeGridAxis.js'],
    ],
    function (a, A, G, H, C, z, D) {
      const {
          series: x,
          seriesTypes: { xrange: u },
        } = H,
        { extend: q, isNumber: r, merge: m } = z;
      D.compose(a, A, x, C);
      class v extends u {
        constructor() {
          super(...arguments);
          this.points = this.options = this.data = void 0;
        }
        drawPoint(a, g) {
          let d = this.options,
            h = this.chart.renderer;
          var m = a.shapeArgs;
          let q = a.plotY,
            v = a.graphic,
            f = a.selected && 'select',
            p = d.stacking && !d.borderRadius;
          if (a.options.milestone)
            if (r(q) && null !== a.y && !1 !== a.visible) {
              m = h.symbols.diamond(
                m.x || 0,
                m.y || 0,
                m.width || 0,
                m.height || 0,
              );
              if (v) v[g]({ d: m });
              else
                a.graphic = h
                  .path(m)
                  .addClass(a.getClassName(), !0)
                  .add(a.group || this.group);
              this.chart.styledMode ||
                a.graphic
                  .attr(this.pointAttribs(a, f))
                  .shadow(d.shadow, null, p);
            } else v && (a.graphic = v.destroy());
          else u.prototype.drawPoint.call(this, a, g);
        }
        translatePoint(a) {
          let g, d;
          u.prototype.translatePoint.call(this, a);
          a.options.milestone &&
            ((g = a.shapeArgs),
            (d = g.height || 0),
            (a.shapeArgs = {
              x: (g.x || 0) - d / 2,
              y: g.y,
              width: d,
              height: d,
            }));
        }
      }
      v.defaultOptions = m(u.defaultOptions, {
        grouping: !1,
        dataLabels: { enabled: !0 },
        tooltip: {
          headerFormat:
            '<span style="font-size: 0.8em">{series.name}</span><br/>',
          pointFormat: null,
          pointFormatter: function () {
            var a = this.series,
              g = a.xAxis;
            let d = a.tooltipOptions.dateTimeLabelFormats,
              k = g.options.startOfWeek,
              m = a.tooltipOptions,
              q = m.xDateFormat,
              u = this.options.milestone,
              f = '<b>' + (this.name || this.yCategory) + '</b>';
            if (m.pointFormat) return this.tooltipFormatter(m.pointFormat);
            !q &&
              r(this.start) &&
              (q = a.chart.time.getDateFormat(
                g.closestPointRange,
                this.start,
                k,
                d || {},
              ));
            g = a.chart.time.dateFormat(q, this.start);
            a = a.chart.time.dateFormat(q, this.end);
            f += '<br/>';
            return u
              ? f + (g + '<br/>')
              : f + ('Start: ' + g + '<br/>End: ') + (a + '<br/>');
          },
        },
        connectors: {
          type: 'simpleConnect',
          animation: { reversed: !0 },
          radius: 0,
          startMarker: {
            enabled: !0,
            symbol: 'arrow-filled',
            radius: 4,
            fill: '#fa0',
            align: 'left',
          },
          endMarker: { enabled: !1, align: 'right' },
        },
      });
      q(v.prototype, {
        pointArrayMap: ['start', 'end', 'y'],
        pointClass: G,
        setData: x.prototype.setData,
      });
      H.registerSeriesType('gantt', v);
      ('');
      return v;
    },
  );
  M(
    a,
    'Core/Chart/GanttChart.js',
    [a['Core/Chart/Chart.js'], a['Core/Defaults.js'], a['Core/Utilities.js']],
    function (a, A, G) {
      const { getOptions: x } = A,
        { isArray: C, merge: z, splat: D } = G;
      class B extends a {
        init(a, q) {
          const r = x(),
            m = a.xAxis,
            u = a.yAxis;
          let h;
          a.xAxis = a.yAxis = void 0;
          const g = z(
            !0,
            {
              chart: { type: 'gantt' },
              title: { text: null },
              legend: { enabled: !1 },
              navigator: {
                series: { type: 'gantt' },
                yAxis: { type: 'category' },
              },
            },
            a,
            { isGantt: !0 },
          );
          a.xAxis = m;
          a.yAxis = u;
          g.xAxis = (C(a.xAxis) ? a.xAxis : [a.xAxis || {}, {}]).map(
            function (a, g) {
              1 === g && (h = 0);
              return z(
                r.xAxis,
                { grid: { enabled: !0 }, opposite: !0, linkedTo: h },
                a,
                { type: 'datetime' },
              );
            },
          );
          g.yAxis = D(a.yAxis || {}).map(function (a) {
            return z(
              r.yAxis,
              {
                grid: { enabled: !0 },
                staticScale: 50,
                reversed: !0,
                type: a.categories ? a.type : 'treegrid',
              },
              a,
            );
          });
          super.init(g, q);
        }
      }
      (function (a) {
        a.ganttChart = function (q, r, m) {
          return new a(q, r, m);
        };
      })(B || (B = {}));
      return B;
    },
  );
  M(a, 'Extensions/ArrowSymbols.js', [a['Core/Utilities.js']], function (a) {
    function x(a, x, u, q) {
      return [
        ['M', a, x + q / 2],
        ['L', a + u, x],
        ['L', a, x + q / 2],
        ['L', a + u, x + q],
      ];
    }
    function G(a, z, u, q) {
      return x(a, z, u / 2, q);
    }
    function H(a, x, u, q) {
      return [['M', a + u, x], ['L', a, x + q / 2], ['L', a + u, x + q], ['Z']];
    }
    function C(a, x, u, q) {
      return H(a, x, u / 2, q);
    }
    const z = [];
    return {
      compose: function (A) {
        a.pushUnique(z, A) &&
          ((A = A.prototype.symbols),
          (A.arrow = x),
          (A['arrow-filled'] = H),
          (A['arrow-filled-half'] = C),
          (A['arrow-half'] = G),
          (A['triangle-left'] = H),
          (A['triangle-left-half'] = C));
      },
    };
  });
  M(
    a,
    'Extensions/CurrentDateIndication.js',
    [a['Core/Utilities.js']],
    function (a) {
      function x() {
        const a = this.options;
        var r = a.currentDateIndicator;
        r &&
          ((r = 'object' === typeof r ? z(u, r) : z(u)),
          (r.value = Date.now()),
          (r.className = 'highcharts-current-date-indicator'),
          a.plotLines || (a.plotLines = []),
          a.plotLines.push(r));
      }
      function G() {
        this.label &&
          this.label.attr({ text: this.getLabelText(this.options.label) });
      }
      function H(a, r) {
        const m = this.options;
        return m &&
          m.className &&
          -1 !== m.className.indexOf('highcharts-current-date-indicator') &&
          m.label &&
          'function' === typeof m.label.formatter
          ? ((m.value = Date.now()),
            m.label.formatter.call(this, m.value, m.label.format))
          : a.call(this, r);
      }
      const { addEvent: C, merge: z, wrap: D } = a,
        B = [],
        u = {
          color: '#ccd3ff',
          width: 2,
          label: {
            format: '%a, %b %d %Y, %H:%M',
            formatter: function (a, r) {
              return this.axis.chart.time.dateFormat(r || '', a);
            },
            rotation: 0,
            style: { fontSize: '0.7em' },
          },
        };
      return {
        compose: function (q, r) {
          a.pushUnique(B, q) && C(q, 'afterSetOptions', x);
          a.pushUnique(B, r) &&
            (C(r, 'render', G), D(r.prototype, 'getLabelText', H));
        },
      };
    },
  );
  M(
    a,
    'masters/modules/gantt.src.js',
    [
      a['Core/Globals.js'],
      a['Stock/Navigator/Navigator.js'],
      a['Stock/Scrollbar/Scrollbar.js'],
      a['Stock/RangeSelector/RangeSelector.js'],
      a['Series/XRange/XRangeSeries.js'],
      a['Core/Chart/GanttChart.js'],
      a['Extensions/ArrowSymbols.js'],
      a['Extensions/CurrentDateIndication.js'],
    ],
    function (a, A, G, H, C, z, D, B) {
      a.GanttChart = z;
      a.ganttChart = z.ganttChart;
      a.Navigator = A;
      a.RangeSelector = H;
      a.Scrollbar = G;
      D.compose(a.SVGRenderer);
      B.compose(a.Axis, a.PlotLineOrBand);
      A.compose(a.Axis, a.Chart, a.Series);
      H.compose(a.Axis, a.Chart);
      G.compose(a.Axis);
      C.compose(a.Axis);
    },
  );
  M(
    a,
    'masters/highcharts-gantt.src.js',
    [a['masters/highcharts.src.js']],
    function (a) {
      a.product = 'Highcharts Gantt';
      return a;
    },
  );
  a['masters/highcharts-gantt.src.js']._modules = a;
  return a['masters/highcharts-gantt.src.js'];
});
//# sourceMappingURL=highcharts-gantt.js.map
export default window.Highcharts;

/**
 * 处理事件触发
 * @param context
 * @param eventName
 * @param rest
 * @returns
 */
const handleTriggerEvent = function (context, eventName, ...rest) {
  const realEventName = `handle${eventName}`;
  if (typeof context[realEventName] === 'function') {
    return context[realEventName].apply(context, rest);
  }
};

const axisColor = '#e0e0e0'
export const getPresetOptions = (context) => {
  return {
    chart: {
      spacingTop: 0,
      spacingRight: 0,
      spacingBottom: 0,
      spacingLeft: 0,
      scrollablePlotArea: {
        opacity: 0.5,
        minWidth: 1000, // 内容的最小宽度
        minHeight: 100,
        scrollPositionX: 0, // 初始水平滚动位置
      },
    },
    time: {
      timezoneOffset: -8 * 60,
    },
    // 内置文案中文化（Highcharts 通过 lang 控制）
    lang: {
      resetZoom: '重置缩放',
      resetZoomTitle: '重置为 1:1',
      rangeSelectorZoom: '缩放',
      rangeSelectorFrom: '从',
      rangeSelectorTo: '到',
      months: [
        '一月',
        '二月',
        '三月',
        '四月',
        '五月',
        '六月',
        '七月',
        '八月',
        '九月',
        '十月',
        '十一月',
        '十二月',
      ],
      shortMonths: [
        '1月',
        '2月',
        '3月',
        '4月',
        '5月',
        '6月',
        '7月',
        '8月',
        '9月',
        '10月',
        '11月',
        '12月',
      ],
      weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    },
    // 范围选择器：按钮与日期输入框文案中文化
    rangeSelector: {
      // 显示与编辑均使用 yyyy-MM-dd
      inputDateFormat: '%Y-%m-%d',
      inputEditDateFormat: '%Y-%m-%d',
      // 中文文案更宽，放宽按钮宽度避免文字被裁切
      buttonTheme: {
        width: 52,
      },
      buttons: [
        { type: 'month', count: 1, text: '1月' },
        { type: 'month', count: 3, text: '3月' },
        { type: 'month', count: 6, text: '6月' },
        { type: 'ytd', text: '年初至今' },
        { type: 'year', count: 1, text: '1年' },
        { type: 'all', text: '全部' },
      ],
    },
    xAxis: {
      lineColor: axisColor,
      tickColor: axisColor,
      minorTickColor: axisColor,
      dateTimeLabelFormats: {
        millisecond: '%H:%M:%S.%L',
        second: '%H:%M:%S',
        minute: '%H:%M',
        hour: '%H:%M',
        day: '%Y-%m-%d',
        week: '%Y-%m',
        month: '%Y-%m',
        year: '%Y',
      },
    },
    yAxis: {
      lineColor: axisColor,
      tickColor: axisColor,
    },
    plotOptions: {
      series: {
        dataGrouping: {
          dateTimeLabelFormats: {
            millisecond: [
              '%Y-%m-%d %H:%M:%S.%L',
              '%Y-%m-%d %H:%M:%S.%L',
              ' ~ %H:%M:%S.%L',
            ],
            second: ['%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M:%S', ' ~ %H:%M:%S'],
            minute: ['%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M', ' ~ %H:%M'],
            hour: ['%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M', ' ~ %H:%M'],
            day: ['%Y-%m-%d', '%Y-%m-%d', ' ~ %Y-%m-%d'],
            week: ['%Y-%m-%d', '%Y-%m-%d', ' ~ %Y-%m-%d'],
            month: ['%Y-%m', '%Y-%m', ' ~ %Y-%m'],
            year: ['%Y', '%Y', ' ~ %Y'],
          },
        },

        point: {
          stickyTracking: false,
          events: {
            click: function (event) {
              handleTriggerEvent(context, 'PointClick', event);
            },
            // 鼠标右键点击进度条
            contextmenu: function (event) {
              handleTriggerEvent(context, 'PointClickMouseY', event);
              event.preventDefault();
            },
            // 双击进度条
            dblclick: function (event) {
              handleTriggerEvent(context, 'PointDblclick', event);
            },
            // 进度条拖拽开始
            dragStart: function (event) {
              handleTriggerEvent(context, 'PointDragStart', event);
            },
            drag: function (event) {
              handleTriggerEvent(context, 'PointDraging', event);
            },
            drop: function (event) {
              handleTriggerEvent(context, 'PointDragEnd', event);
            },
          },
        },
      },
    },
    credits: {
      enabled: false,
    },
  };
};

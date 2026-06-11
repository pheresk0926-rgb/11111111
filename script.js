/**
 * 全国城市空气质量与气象历史数据可视化平台
 * ==========================================
 * 功能：
 *   1. 加载 JSON 数据并渲染概览、趋势、对比图表
 *   2. 使用 ECharts 实现交互式可视化
 *   3. 根据数据自动生成数据新闻解读文字
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // 全局状态
  // -------------------------------------------------------------------------
  var airQualityData = null;
  var weatherData = null;
  var cityList = [];
  var charts = {};
  var configuredCities = [];
  var apiAvailable = false;
  var CHART_NOT_MERGE = { notMerge: true };

  // AQI 等级颜色映射
  var AQI_COLORS = {
    good: "#34a853",
    moderate: "#f9ab00",
    unhealthy: "#ea4335",
    default: "#1a73e8",
  };

  // -------------------------------------------------------------------------
  // 数据加载
  // -------------------------------------------------------------------------

  /**
   * 并行加载空气质量与气象 JSON 数据
   * @param {boolean} bustCache 为 true 时追加时间戳，绕过浏览器缓存实现随时刷新
   */
  function applyLoadedData(air, weather) {
    airQualityData = air;
    weatherData = weather;
    cityList = Object.keys(airQualityData.cities).map(function (id) {
      return { id: id, name: airQualityData.cities[id].name };
    });
  }

  /** 将 API 返回的最新数据集写入内存（删除/爬取后直接刷新，无需再 fetch） */
  function applyServerPayload(body) {
    if (body.air_quality && body.weather) {
      applyLoadedData(body.air_quality, body.weather);
    }
    if (body.cities) {
      configuredCities = body.cities;
    }
  }

  function loadEmbeddedData() {
    if (apiAvailable) return false;
    if (window.EMBEDDED_AIR_QUALITY && window.EMBEDDED_WEATHER) {
      applyLoadedData(window.EMBEDDED_AIR_QUALITY, window.EMBEDDED_WEATHER);
      return true;
    }
    return false;
  }

  function loadData(bustCache) {
    if (apiAvailable) {
      var apiUrl = "/api/data" + (bustCache ? "?t=" + Date.now() : "");
      return apiJson(apiUrl).then(function (result) {
        if (!result.ok) throw new Error(result.body.message || "加载数据失败");
        applyServerPayload(result.body);
      });
    }

    var cacheSuffix = bustCache ? ("?t=" + Date.now()) : "";
    return Promise.all([
      fetch("data/air_quality.json" + cacheSuffix).then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      }),
      fetch("data/weather.json" + cacheSuffix).then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      }),
    ]).then(function (results) {
      applyLoadedData(results[0], results[1]);
    }).catch(function () {
      if (loadEmbeddedData()) return;
      throw new Error("无法加载数据。请双击「启动平台.bat」或运行 py server.py");
    });
  }

  // -------------------------------------------------------------------------
  // 数据计算工具
  // -------------------------------------------------------------------------

  /**
   * 计算某城市期间平均 AQI
   */
  function getCityAvgAqi(cityId) {
    var records = airQualityData.cities[cityId].records;
    if (!records.length) return 0;
    var sum = records.reduce(function (acc, r) { return acc + r.aqi; }, 0);
    return Math.round(sum / records.length);
  }

  /**
   * 计算某城市期间平均气温
   */
  function getCityAvgTemp(cityId) {
    var records = weatherData.cities[cityId].records;
    if (!records.length) return 0;
    var sum = records.reduce(function (acc, r) { return acc + r.temp_mean; }, 0);
    return Math.round(sum / records.length * 10) / 10;
  }

  /**
   * 获取全国平均 AQI
   */
  function getNationalAvgAqi() {
    var total = 0;
    var count = 0;
    cityList.forEach(function (city) {
      total += getCityAvgAqi(city.id);
      count++;
    });
    return count ? Math.round(total / count) : 0;
  }

  /**
   * 获取全国平均气温
   */
  function getNationalAvgTemp() {
    var total = 0;
    var count = 0;
    cityList.forEach(function (city) {
      total += getCityAvgTemp(city.id);
      count++;
    });
    return count ? Math.round(total / count * 10) / 10 : 0;
  }

  /**
   * 根据 AQI 返回等级文字
   */
  function getAqiLevelText(aqi) {
    if (aqi <= 50) return "优";
    if (aqi <= 100) return "良";
    if (aqi <= 150) return "轻度污染";
    if (aqi <= 200) return "中度污染";
    if (aqi <= 300) return "重度污染";
    return "严重污染";
  }

  /**
   * 根据 AQI 返回颜色
   */
  function getAqiColor(aqi) {
    if (aqi <= 50) return AQI_COLORS.good;
    if (aqi <= 100) return AQI_COLORS.moderate;
    if (aqi <= 150) return "#ff9800";
    return AQI_COLORS.unhealthy;
  }

  /**
   * 计算线性回归斜率，用于判断趋势
   */
  function calcTrendSlope(values) {
    var n = values.length;
    if (n < 2) return 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  /**
   * 格式化日期显示（月/日）
   */
  function formatDate(dateStr) {
    var parts = dateStr.split("-");
    return parseInt(parts[1], 10) + "/" + parseInt(parts[2], 10);
  }

  // -------------------------------------------------------------------------
  // 概览区渲染
  // -------------------------------------------------------------------------

  function renderOverview() {
    var avgAqi = getNationalAvgAqi();
    var avgTemp = getNationalAvgTemp();

    var cityAqiList = cityList.map(function (city) {
      return { id: city.id, name: city.name, aqi: getCityAvgAqi(city.id) };
    });
    cityAqiList.sort(function (a, b) { return a.aqi - b.aqi; });

    var best = cityAqiList[0];
    var worst = cityAqiList[cityAqiList.length - 1];

    document.getElementById("avgAqi").textContent = avgAqi;
    document.getElementById("avgAqiLevel").textContent = "等级：" + getAqiLevelText(avgAqi);
    document.getElementById("bestCity").textContent = best.name;
    document.getElementById("bestAqi").textContent = "AQI " + best.aqi + "（" + getAqiLevelText(best.aqi) + "）";
    document.getElementById("worstCity").textContent = worst.name;
    document.getElementById("worstAqi").textContent = "AQI " + worst.aqi + "（" + getAqiLevelText(worst.aqi) + "）";
    document.getElementById("avgTemp").textContent = avgTemp + "℃";

    var meta = airQualityData.metadata;
    document.getElementById("headerMeta").innerHTML =
      "数据区间：" + meta.date_range.start + " ~ " + meta.date_range.end + "<br>" +
      "爬取时间：" + meta.crawl_time + " · 共 " + meta.cities_count + " 个城市";
  }

  // -------------------------------------------------------------------------
  // 城市选择器
  // -------------------------------------------------------------------------

  function updateCitySelector(preserveCityId) {
    var select = document.getElementById("citySelect");
    var current = preserveCityId || select.value;
    select.innerHTML = "";
    cityList.forEach(function (city, index) {
      var option = document.createElement("option");
      option.value = city.id;
      option.textContent = city.name;
      if (current ? city.id === current : index === 0) option.selected = true;
      select.appendChild(option);
    });
  }

  function initCitySelector() {
    var select = document.getElementById("citySelect");
    select.onchange = function () {
      renderTrendCharts(select.value);
    };
    updateCitySelector();
  }

  function updateCompareCheckboxes(preserveSelected) {
    var container = document.getElementById("compareCheckboxes");
    var selectedSet = {};
    if (preserveSelected && preserveSelected.length) {
      preserveSelected.forEach(function (id) { selectedSet[id] = true; });
    }
    container.innerHTML = "";
    cityList.forEach(function (city, index) {
      var checked = preserveSelected && preserveSelected.length
        ? !!selectedSet[city.id]
        : index < 3;
      var label = document.createElement("label");
      label.className = "checkbox-item" + (checked ? " checked" : "");
      label.innerHTML =
        '<input type="checkbox" value="' + city.id + '"' +
        (checked ? " checked" : "") + "> " + city.name;
      container.appendChild(label);
    });
  }

  function initCompareCheckboxes() {
    var container = document.getElementById("compareCheckboxes");
    container.onchange = function (e) {
      if (e.target && e.target.type === "checkbox") {
        var label = e.target.closest(".checkbox-item");
        if (label) label.classList.toggle("checked", e.target.checked);
        renderCompareCharts();
      }
    };
    updateCompareCheckboxes();
  }

  function getSelectedCompareCities() {
    var checkboxes = document.querySelectorAll("#compareCheckboxes input:checked");
    var selected = [];
    checkboxes.forEach(function (cb) { selected.push(cb.value); });
    return selected;
  }

  // -------------------------------------------------------------------------
  // ECharts 图表
  // -------------------------------------------------------------------------

  function getBaseChartOption() {
    return {
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(255,255,255,0.95)",
        borderColor: "#e5e7eb",
        textStyle: { color: "#1f2937", fontSize: 13 },
      },
    };
  }

  function initChart(domId) {
    var dom = document.getElementById(domId);
    if (!dom) return null;
    var chart = echarts.init(dom);
    charts[domId] = chart;
    return chart;
  }

  function setChartOption(chart, option) {
    if (!chart) return;
    chart.clear();
    chart.setOption(option, CHART_NOT_MERGE);
  }

  /** 对比图保留 ECharts 默认动画（勾选城市时柱状图平滑变化） */
  function setCompareChartOption(chart, option) {
    if (!chart) return;
    chart.setOption(Object.assign({
      animation: true,
      animationDuration: 800,
      animationEasing: "cubicOut",
    }, option));
  }

  function renderTrendCharts(cityId) {
    if (!cityId) cityId = document.getElementById("citySelect").value;
    var airRecords = airQualityData.cities[cityId].records;
    var weatherRecords = weatherData.cities[cityId].records;
    var cityName = airQualityData.cities[cityId].name;

    var dates = airRecords.map(function (r) { return formatDate(r.date); });
    var aqiValues = airRecords.map(function (r) { return r.aqi; });
    var pm25Values = airRecords.map(function (r) { return r.pm25; });
    var tempValues = weatherRecords.map(function (r) { return r.temp_mean; });

    // AQI 趋势
    var aqiChart = charts["aqiTrendChart"] || initChart("aqiTrendChart");
    setChartOption(aqiChart, Object.assign({}, getBaseChartOption(), {
      title: { text: cityName, textStyle: { fontSize: 12, color: "#6b7280" }, left: 0, top: 0 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 11, rotate: dates.length > 15 ? 45 : 0 } },
      yAxis: { type: "value", name: "AQI", nameTextStyle: { fontSize: 11 } },
      series: [{
        name: "AQI",
        type: "line",
        data: aqiValues,
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2.5, color: "#1a73e8" },
        itemStyle: { color: "#1a73e8" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(26,115,232,0.25)" },
            { offset: 1, color: "rgba(26,115,232,0.02)" },
          ]),
        },
        markLine: {
          silent: true,
          data: [
            { yAxis: 50, lineStyle: { color: "#34a853", type: "dashed" }, label: { formatter: "优", fontSize: 10 } },
            { yAxis: 100, lineStyle: { color: "#f9ab00", type: "dashed" }, label: { formatter: "良", fontSize: 10 } },
          ],
        },
      }],
    }));

    // PM2.5 趋势
    var pm25Chart = charts["pm25TrendChart"] || initChart("pm25TrendChart");
    setChartOption(pm25Chart, Object.assign({}, getBaseChartOption(), {
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 11, rotate: dates.length > 15 ? 45 : 0 } },
      yAxis: { type: "value", name: "μg/m³", nameTextStyle: { fontSize: 11 } },
      series: [{
        name: "PM2.5",
        type: "line",
        data: pm25Values,
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2.5, color: "#ea4335" },
        itemStyle: { color: "#ea4335" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(234,67,53,0.2)" },
            { offset: 1, color: "rgba(234,67,53,0.02)" },
          ]),
        },
      }],
    }));

    // 气温趋势
    var tempChart = charts["tempTrendChart"] || initChart("tempTrendChart");
    setChartOption(tempChart, Object.assign({}, getBaseChartOption(), {
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 11, rotate: dates.length > 15 ? 45 : 0 } },
      yAxis: { type: "value", name: "℃", nameTextStyle: { fontSize: 11 } },
      series: [{
        name: "平均气温",
        type: "line",
        data: tempValues,
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2.5, color: "#f9ab00" },
        itemStyle: { color: "#f9ab00" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(249,171,0,0.2)" },
            { offset: 1, color: "rgba(249,171,0,0.02)" },
          ]),
        },
      }],
    }));
  }

  function clearCompareCharts() {
    ["aqiCompareChart", "tempCompareChart"].forEach(function (id) {
      if (charts[id]) charts[id].clear();
    });
  }

  function renderCompareCharts() {
    var selected = getSelectedCompareCities();
    if (!selected.length) return;

    var names = [];
    var aqiValues = [];
    var tempValues = [];
    var aqiColors = [];

    selected.forEach(function (cityId) {
      var aqi = getCityAvgAqi(cityId);
      names.push(airQualityData.cities[cityId].name);
      aqiValues.push(aqi);
      aqiColors.push(getAqiColor(aqi));
      tempValues.push(getCityAvgTemp(cityId));
    });

    var aqiCompareChart = charts["aqiCompareChart"] || initChart("aqiCompareChart");
    setCompareChartOption(aqiCompareChart, Object.assign({}, getBaseChartOption(), {
      grid: { left: 50, right: 20, top: 20, bottom: 50 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 11, rotate: names.length > 5 ? 30 : 0 },
      },
      yAxis: { type: "value", name: "AQI" },
      series: [{
        name: "平均 AQI",
        type: "bar",
        data: aqiValues.map(function (val, i) {
          return { value: val, itemStyle: { color: aqiColors[i] } };
        }),
        barMaxWidth: 50,
        label: { show: true, position: "top", fontSize: 11 },
      }],
    }));

    var tempCompareChart = charts["tempCompareChart"] || initChart("tempCompareChart");
    setCompareChartOption(tempCompareChart, Object.assign({}, getBaseChartOption(), {
      grid: { left: 50, right: 20, top: 20, bottom: 50 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 11, rotate: names.length > 5 ? 30 : 0 },
      },
      yAxis: { type: "value", name: "℃" },
      series: [{
        name: "平均气温",
        type: "bar",
        data: tempValues,
        barMaxWidth: 50,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#f9ab00" },
            { offset: 1, color: "#ff6d00" },
          ]),
        },
        label: { show: true, position: "top", fontSize: 11, formatter: "{c}℃" },
      }],
    }));
  }

  // -------------------------------------------------------------------------
  // 数据新闻解读（自动生成分析结论）
  // -------------------------------------------------------------------------

  function generateNewsAnalysis() {
    var paragraphs = [];
    var days = airQualityData.metadata.days;
    var nationalAvgAqi = getNationalAvgAqi();
    var nationalAvgTemp = getNationalAvgTemp();

    // 1. 各城市 AQI 趋势分析
    cityList.forEach(function (city) {
      var records = airQualityData.cities[city.id].records;
      if (records.length < 5) return;

      var aqiValues = records.map(function (r) { return r.aqi; });
      var slope = calcTrendSlope(aqiValues);
      var avgAqi = getCityAvgAqi(city.id);
      var firstHalf = aqiValues.slice(0, Math.floor(aqiValues.length / 2));
      var secondHalf = aqiValues.slice(Math.floor(aqiValues.length / 2));
      var firstAvg = firstHalf.reduce(function (a, b) { return a + b; }, 0) / firstHalf.length;
      var secondAvg = secondHalf.reduce(function (a, b) { return a + b; }, 0) / secondHalf.length;
      var change = Math.round(secondAvg - firstAvg);

      if (slope < -0.5) {
        paragraphs.push(
          "<p>近 <span class='highlight'>" + days + " 天</span>内，" +
          "<span class='highlight'>" + city.name + "</span> AQI 整体呈" +
          "<span class='good'>下降趋势</span>（后半段较前半段" +
          (change < 0 ? "降低 " + Math.abs(change) + " 点" : "变化 " + change + " 点") +
          "），空气质量<span class='good'>有所改善</span>，期间平均 AQI 为 " + avgAqi +
          "（" + getAqiLevelText(avgAqi) + "）。</p>"
        );
      } else if (slope > 0.5) {
        paragraphs.push(
          "<p>近 <span class='highlight'>" + days + " 天</span>内，" +
          "<span class='highlight'>" + city.name + "</span> AQI 整体呈" +
          "<span class='bad'>上升趋势</span>（后半段较前半段" +
          (change > 0 ? "上升 " + change + " 点" : "变化 " + change + " 点") +
          "），空气质量<span class='bad'>有所恶化</span>，期间平均 AQI 为 " + avgAqi +
          "（" + getAqiLevelText(avgAqi) + "）。</p>"
        );
      }
    });

    // 2. 温度与全国均值对比
    cityList.forEach(function (city) {
      var avgTemp = getCityAvgTemp(city.id);
      var diff = Math.round((avgTemp - nationalAvgTemp) * 10) / 10;
      if (Math.abs(diff) >= 2) {
        if (diff > 0) {
          paragraphs.push(
            "<p><span class='highlight'>" + city.name + "</span> 平均气温（" + avgTemp +
            "℃）<span class='bad'>高于</span>全国平均水平（" + nationalAvgTemp +
            "℃），高出约 " + diff + "℃。</p>"
          );
        } else {
          paragraphs.push(
            "<p><span class='highlight'>" + city.name + "</span> 平均气温（" + avgTemp +
            "℃）<span class='good'>低于</span>全国平均水平（" + nationalAvgTemp +
            "℃），低约 " + Math.abs(diff) + "℃。</p>"
          );
        }
      }
    });

    // 3. 空气质量最优/最差城市
    var cityAqiList = cityList.map(function (city) {
      return { name: city.name, aqi: getCityAvgAqi(city.id) };
    });
    cityAqiList.sort(function (a, b) { return a.aqi - b.aqi; });
    var best = cityAqiList[0];
    var worst = cityAqiList[cityAqiList.length - 1];

    paragraphs.push(
      "<p>在监测的 <span class='highlight'>" + cityList.length + " 个主要城市</span>中，" +
      "<span class='good'>" + best.name + "</span> 空气质量最佳（平均 AQI " + best.aqi +
      "），<span class='bad'>" + worst.name + "</span> 空气质量最差（平均 AQI " + worst.aqi +
      "）。全国平均 AQI 为 <span class='highlight'>" + nationalAvgAqi + "</span>（" +
      getAqiLevelText(nationalAvgAqi) + "）。</p>"
    );

    // 4. PM2.5 分析
    var pm25Ranking = cityList.map(function (city) {
      var records = airQualityData.cities[city.id].records;
      var avgPm25 = records.reduce(function (a, r) { return a + r.pm25; }, 0) / records.length;
      return { name: city.name, pm25: Math.round(avgPm25 * 10) / 10 };
    });
    pm25Ranking.sort(function (a, b) { return b.pm25 - a.pm25; });
    var highestPm25 = pm25Ranking[0];
    var lowestPm25 = pm25Ranking[pm25Ranking.length - 1];

    paragraphs.push(
      "<p>PM2.5 浓度方面，<span class='bad'>" + highestPm25.name + "</span> 最高（均值 " +
      highestPm25.pm25 + " μg/m³），<span class='good'>" + lowestPm25.name +
      "</span> 最低（均值 " + lowestPm25.pm25 + " μg/m³）。" +
      (highestPm25.pm25 > 75
        ? highestPm25.name + " 的 PM2.5 均值超过国家标准二级限值（75 μg/m³），需持续关注。"
        : "各城市 PM2.5 均值均在国家标准二级限值以内。") +
      "</p>"
    );

    // 5. 天气概况
    var weatherSummary = {};
    cityList.forEach(function (city) {
      var records = weatherData.cities[city.id].records;
      records.forEach(function (r) {
        weatherSummary[r.weather] = (weatherSummary[r.weather] || 0) + 1;
      });
    });
    var sortedWeather = Object.keys(weatherSummary).sort(function (a, b) {
      return weatherSummary[b] - weatherSummary[a];
    });
    if (sortedWeather.length > 0) {
      paragraphs.push(
        "<p>气象方面，监测期间出现最多的天气状况为「<span class='highlight'>" +
        sortedWeather[0] + "</span>」（共 " + weatherSummary[sortedWeather[0]] + " 天·城市次），" +
        (sortedWeather[1] ? "其次为「" + sortedWeather[1] + "」（" + weatherSummary[sortedWeather[1]] + " 天·城市次）。" : "") +
        "全国平均气温 <span class='highlight'>" + nationalAvgTemp + "℃</span>。</p>"
      );
    }

    document.getElementById("newsContent").innerHTML = paragraphs.join("");
    document.getElementById("newsTime").textContent =
      "分析生成时间：" + new Date().toLocaleString("zh-CN");
  }

  // -------------------------------------------------------------------------
  // 窗口自适应
  // -------------------------------------------------------------------------

  function handleResize() {
    Object.keys(charts).forEach(function (key) {
      if (charts[key]) charts[key].resize();
    });
  }

  // -------------------------------------------------------------------------
  // 刷新数据
  // -------------------------------------------------------------------------

  function renderAll() {
    cityList = Object.keys(airQualityData.cities).map(function (id) {
      return { id: id, name: airQualityData.cities[id].name };
    });
    if (!cityList.length) {
      document.getElementById("avgAqi").textContent = "--";
      document.getElementById("avgAqiLevel").textContent = "";
      document.getElementById("bestCity").textContent = "--";
      document.getElementById("bestAqi").textContent = "";
      document.getElementById("worstCity").textContent = "--";
      document.getElementById("worstAqi").textContent = "";
      document.getElementById("avgTemp").textContent = "--";
      document.getElementById("newsContent").innerHTML = "<p>暂无城市数据，请搜索并添加城市。</p>";
      Object.keys(charts).forEach(function (key) {
        if (charts[key]) charts[key].clear();
      });
      return;
    }
    var selectedCity = document.getElementById("citySelect").value;
    if (!airQualityData.cities[selectedCity]) selectedCity = cityList[0].id;
    var selectedCompare = getSelectedCompareCities().filter(function (id) {
      return airQualityData.cities[id];
    });
    renderOverview();
    updateCitySelector(selectedCity);
    updateCompareCheckboxes(selectedCompare.length ? selectedCompare : null);
    renderTrendCharts(document.getElementById("citySelect").value);
    clearCompareCharts();
    renderCompareCharts();
    generateNewsAnalysis();
  }

  function showSyncOverlay(show) {
    var el = document.getElementById("loadingOverlay");
    if (!el) return;
    if (show) {
      el.classList.remove("hidden");
      el.innerHTML = "<p style='color:#1a73e8;font-size:1rem;'>正在同步图表...</p>";
    } else {
      el.classList.add("hidden");
    }
  }

  /** 重新加载数据并刷新全部图表（添加/删除/爬取后统一调用） */
  function syncUI(message, type, serverPayload) {
    showSyncOverlay(true);
    var dataPromise;
    if (serverPayload && serverPayload.air_quality && serverPayload.weather) {
      dataPromise = Promise.resolve().then(function () {
        applyServerPayload(serverPayload);
      });
    } else {
      dataPromise = loadData(true);
    }
    return dataPromise.then(function () {
      if (serverPayload && serverPayload.cities) {
        renderConfiguredCityList();
        return;
      }
      return loadConfiguredCities();
    }).then(function () {
      renderAll();
      if (message) setCityStatus(message, type || "success");
    }).finally(function () {
      showSyncOverlay(false);
    });
  }

  function apiJson(url, options) {
    return fetch(url, options || {}).then(function (res) {
      return res.json().then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }

  function refreshData() {
    var btn = document.getElementById("refreshBtn");
    btn.disabled = true;
    btn.textContent = "刷新中...";
    syncUI()
      .catch(function (err) { alert("刷新失败：" + err.message); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "🔄 刷新显示";
      });
  }

  function bindRefreshButton() {
    document.getElementById("refreshBtn").addEventListener("click", refreshData);
    document.getElementById("onlineUpdateBtn").addEventListener("click", onlineUpdate);
    window.addEventListener("online", checkNetworkStatus);
    window.addEventListener("offline", checkNetworkStatus);
    checkNetworkStatus();
  }

  // -------------------------------------------------------------------------
  // 联网状态检测与联网更新
  // -------------------------------------------------------------------------

  var isNetworkOnline = false;

  function setNetworkStatus(online, message) {
    isNetworkOnline = online;
    var dot = document.getElementById("netDot");
    var text = document.getElementById("netText");
    dot.className = "net-dot " + (online ? "net-online" : "net-offline");
    text.textContent = message || (online ? "已联网" : "未联网");
    document.getElementById("onlineUpdateBtn").disabled = !online || !apiAvailable;
  }

  function checkNetworkStatus() {
    if (!navigator.onLine) {
      setNetworkStatus(false, "未联网（无网络连接）");
      return;
    }

    document.getElementById("netDot").className = "net-dot net-checking";
    document.getElementById("netText").textContent = "检测联网...";

    if (apiAvailable) {
      fetch("/api/online")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          setNetworkStatus(data.online, data.online ? "已联网 · 可获取最新数据" : data.message);
        })
        .catch(function () {
          testOpenMeteoDirect();
        });
    } else {
      testOpenMeteoDirect();
    }
  }

  function testOpenMeteoDirect() {
    fetch("https://api.open-meteo.com/v1/forecast?latitude=39.9&longitude=116.4&current=temperature_2m", {
      method: "GET",
      mode: "cors",
    })
      .then(function (res) {
        setNetworkStatus(res.ok, res.ok ? "已联网 · 可搜索城市" : "数据源异常");
      })
      .catch(function () {
        setNetworkStatus(false, "未联网或数据源不可达");
      });
  }

  function onlineUpdate() {
    if (!navigator.onLine) {
      alert("当前无网络连接，请检查网络后重试。");
      return;
    }
    if (!apiAvailable) {
      alert("联网更新需要先用 py server.py 启动服务器。\n\n纯静态模式只能「刷新显示」本地已有数据。");
      return;
    }
    if (!confirm("将从互联网（Open-Meteo）重新爬取全部城市近 30 天数据，约需 10～30 秒，是否继续？")) {
      return;
    }

    var btn = document.getElementById("onlineUpdateBtn");
    btn.disabled = true;
    btn.textContent = "联网更新中...";

    runCrawl(null, true)
      .then(function () {
        btn.textContent = "🌐 联网更新";
        checkNetworkStatus();
      })
      .catch(function (err) {
        alert("联网更新失败：" + (err.message || "请检查网络"));
        btn.textContent = "🌐 联网更新";
      })
      .finally(function () {
        btn.disabled = !isNetworkOnline || !apiAvailable;
      });
  }

  // -------------------------------------------------------------------------
  // 城市管理：搜索、添加、删除、爬取
  // -------------------------------------------------------------------------

  var chinaCities = [];
  var lastSearchResults = [];
  var lastBestMatch = null;

  var PINYIN_MAP = {
    "北京": "beijing", "上海": "shanghai", "广州": "guangzhou", "深圳": "shenzhen",
    "杭州": "hangzhou", "南京": "nanjing", "成都": "chengdu", "重庆": "chongqing",
    "武汉": "wuhan", "西安": "xian", "苏州": "suzhou", "天津": "tianjin",
    "青岛": "qingdao", "大连": "dalian", "厦门": "xiamen", "长沙": "changsha",
    "郑州": "zhengzhou", "沈阳": "shenyang", "哈尔滨": "haerbin", "福州": "fuzhou",
    "济南": "jinan", "合肥": "hefei", "昆明": "kunming", "南昌": "nanchang",
    "贵阳": "guiyang", "太原": "taiyuan", "石家庄": "shijiazhuang", "长春": "changchun",
    "南宁": "nanning", "海口": "haikou", "兰州": "lanzhou", "银川": "yinchuan",
    "西宁": "xining", "拉萨": "lasa", "呼和浩特": "huhehaote", "乌鲁木齐": "wulumuqi",
  };

  function suggestCityId(name, geoId) {
    if (PINYIN_MAP[name]) return PINYIN_MAP[name];
    if (geoId) return "city_" + geoId;
    return "city_" + Date.now().toString(36);
  }

  function normalizeKeyword(keyword) {
    return keyword.trim().replace(/市$|县$|区$/, "");
  }

  function loadChinaCities() {
    return fetch("data/china_cities.json")
      .then(function (res) { return res.json(); })
      .then(function (data) { chinaCities = data || []; })
      .catch(function () { chinaCities = []; });
  }

  function getCityDisplayName(city) {
    if (city.alias) return city.alias;
    var sameName = chinaCities.filter(function (c) { return c.name === city.name; });
    if (sameName.length > 1 && city.province) {
      return city.name + "（" + city.province.replace(/省|市|自治区|特别行政区/g, "") + "）";
    }
    return city.name;
  }

  function scoreLocalCity(city, keyword) {
    var kw = normalizeKeyword(keyword);
    var name = city.name;
    var province = city.province || "";
    var alias = city.alias || "";
    var score = 0;

    if (name === kw || name + "市" === keyword.trim()) score += 100;
    else if (name.indexOf(kw) === 0) score += 80;
    else if (kw.indexOf(name) === 0) score += 70;
    else if (alias.indexOf(kw) >= 0) score += 75;
    else if (province.indexOf(kw) >= 0) score += 40;
    else return -1;

    if (city.level === "直辖市" || city.level === "省会") score += 10;
    return score;
  }

  function searchLocalCities(keyword) {
    var scored = chinaCities
      .map(function (city) {
        return { city: city, score: scoreLocalCity(city, keyword) };
      })
      .filter(function (item) { return item.score >= 0; })
      .sort(function (a, b) { return b.score - a.score; });

    return scored.map(function (item) {
      var city = item.city;
      return {
        _source: "local",
        id: city.id,
        name: city.name,
        displayName: getCityDisplayName(city),
        province: city.province,
        level: city.level,
        latitude: city.latitude,
        longitude: city.longitude,
        score: item.score,
      };
    });
  }

  var GEO_LEVEL_SCORE = {
    PPLC: 100, PPLA: 90, PPLA2: 80, PPLA3: 60, PPL: 10,
  };

  function filterApiResults(keyword, results) {
    var kw = normalizeKeyword(keyword);
    return (results || [])
      .filter(function (item) {
        if (item.country_code !== "CN") return false;
        var code = item.feature_code || "PPL";
        if (code === "PPL" && (!item.population || item.population < 100000)) return false;

        var name = item.name || "";
        var exact = name === kw || name === kw + "市";
        var starts = name.indexOf(kw) === 0;
        var admin1 = item.admin1 || "";
        var admin2 = item.admin2 || "";

        if (exact || starts) return true;
        if ((code === "PPLA" || code === "PPLA2" || code === "PPLC") && admin1.indexOf(kw) >= 0) return true;
        if (admin2 && admin2.indexOf(kw) >= 0 && name.length <= kw.length + 2) return true;
        return false;
      })
      .map(function (item) {
        var code = item.feature_code || "PPL";
        var popScore = item.population ? Math.log10(item.population) : 0;
        return {
          _source: "api",
          id: suggestCityId(item.name, item.id),
          geoId: item.id,
          name: item.name,
          displayName: item.name,
          province: [item.admin1, item.admin2].filter(Boolean).join(" · "),
          level: code,
          latitude: item.latitude,
          longitude: item.longitude,
          score: (GEO_LEVEL_SCORE[code] || 0) + popScore,
        };
      })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function mergeSearchResults(keyword, localResults, apiResults) {
    var merged = localResults.slice();
    var localNames = {};

    localResults.forEach(function (item) {
      localNames[item.name + "|" + (item.province || "")] = true;
      if (item.score >= 100) localNames["__exact__" + normalizeKeyword(keyword)] = true;
    });

    apiResults.forEach(function (item) {
      var key = item.name + "|" + (item.province || "");
      if (localNames[key]) return;
      if (localNames["__exact__" + normalizeKeyword(keyword)] && item.name === normalizeKeyword(keyword)) return;
      var dupId = merged.some(function (m) {
        return Math.abs(m.latitude - item.latitude) < 0.5 && Math.abs(m.longitude - item.longitude) < 0.5;
      });
      if (!dupId) merged.push(item);
    });

    return merged.slice(0, 10);
  }

  function isCityConfigured(cityId) {
    return configuredCities.some(function (c) { return c.id === cityId; });
  }

  function buildCityPayload(item) {
    return {
      id: item.id || suggestCityId(item.name, item.geoId),
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
    };
  }

  function getBestMatch(results) {
    for (var i = 0; i < results.length; i++) {
      var payload = buildCityPayload(results[i]);
      if (!isCityConfigured(payload.id)) {
        return results[i];
      }
    }
    return null;
  }

  function updateApiWarning(reason) {
    var el = document.getElementById("apiWarning");
    if (!el) return;
    if (apiAvailable) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    if (location.protocol === "file:") {
      el.innerHTML = "⚠️ 您当前打开的是<strong>本地文件</strong>，无法添加城市。<br>请关闭本页，双击文件夹中的 <strong>启动平台.bat</strong>，等待浏览器自动打开。";
    } else if (reason) {
      el.innerHTML = "⚠️ " + reason;
    } else {
      el.innerHTML = "⚠️ 当前为<strong>只读模式</strong>（可查看图表，无法添加/删除城市）。<br>完整功能请在本机运行 <strong>启动平台.bat</strong>，或用局域网地址访问；互联网发布请运行 <strong>发布网站.bat</strong> 打包上传。";
    }
  }

  function validateApiResponse(res) {
    if (!res.ok) return Promise.reject(new Error("HTTP " + res.status));
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("json") === -1) return Promise.reject(new Error("非 API 服务器"));
    return res.json().then(function (data) {
      if (!data || (data.cities === undefined && !data.ok)) {
        return Promise.reject(new Error("API 数据无效"));
      }
      return data;
    });
  }

  function waitForApi(maxTry, intervalMs) {
    var attempt = 0;
    function tryOnce() {
      return fetch("/api/ping")
        .then(validateApiResponse)
        .then(function () {
          return fetch("/api/cities").then(validateApiResponse);
        })
        .then(function (data) {
          apiAvailable = true;
          updateApiWarning();
          var btn = document.getElementById("onlineUpdateBtn");
          if (btn) btn.disabled = false;
          return data;
        })
        .catch(function (err) {
          attempt++;
          if (attempt >= maxTry) {
            apiAvailable = false;
            if (location.protocol === "file:") {
              updateApiWarning();
            } else {
              updateApiWarning("端口 " + location.port + " 上的服务不支持添加城市（可能不是本平台服务器）。请关闭所有命令行窗口，重新双击「启动平台.bat」。");
            }
            var btn = document.getElementById("onlineUpdateBtn");
            if (btn) btn.disabled = true;
            return null;
          }
          return new Promise(function (resolve) {
            setTimeout(resolve, intervalMs);
          }).then(tryOnce);
        });
    }
    return tryOnce();
  }

  function updateQuickAddButton() {
    var btn = document.getElementById("quickAddBtn");
    if (!btn) return;
    lastBestMatch = getBestMatch(lastSearchResults);
    if (lastBestMatch) {
      var label = lastBestMatch.displayName || lastBestMatch.name;
      btn.style.display = "inline-block";
      btn.textContent = "一键添加「" + label + "」";
      btn.disabled = !apiAvailable;
    } else if (lastSearchResults.length > 0) {
      btn.style.display = "inline-block";
      btn.textContent = "均已添加";
      btn.disabled = true;
    } else {
      btn.style.display = "none";
    }
  }

  function ensureApi() {
    if (apiAvailable) return Promise.resolve(true);
    if (location.protocol === "file:") {
      updateApiWarning();
      return Promise.reject(new Error("请双击「启动平台.bat」打开，不要用本地文件方式"));
    }
    return fetch("/api/ping")
      .then(validateApiResponse)
      .then(function () {
        apiAvailable = true;
        updateApiWarning();
        document.getElementById("onlineUpdateBtn").disabled = false;
        return true;
      })
      .catch(function () {
        apiAvailable = false;
        updateApiWarning();
        document.getElementById("onlineUpdateBtn").disabled = true;
        return Promise.reject(new Error("请关闭所有命令行窗口，重新双击「启动平台.bat」"));
      });
  }

  function setCityStatus(message, type) {
    var el = document.getElementById("cityManageStatus");
    el.textContent = message || "";
    el.className = "status-msg" + (type ? " " + type : "");
  }

  function hasCityData(cityId) {
    return airQualityData && airQualityData.cities && airQualityData.cities[cityId];
  }

  function loadConfiguredCities() {
    return waitForApi(20, 500).then(function (data) {
      if (data && data.cities) {
        configuredCities = data.cities;
      } else if (airQualityData) {
        configuredCities = Object.keys(airQualityData.cities).map(function (id) {
          var c = airQualityData.cities[id];
          return { id: id, name: c.name, latitude: c.latitude, longitude: c.longitude };
        });
      }
      renderConfiguredCityList();
    });
  }

  function renderConfiguredCityList() {
    var container = document.getElementById("configuredCityList");
    if (!configuredCities.length) {
      container.innerHTML = "<p class='empty-hint'>暂无城市，请搜索并添加。</p>";
      return;
    }

    container.innerHTML = configuredCities.map(function (city) {
      var hasData = hasCityData(city.id);
      var dataBadge = hasData
        ? "<span style='color:#34a853'>已有数据</span>"
        : "<span style='color:#ea4335'>待爬取</span>";
      var removeBtn = apiAvailable
        ? "<button type='button' class='btn-remove' data-id='" + city.id + "' title='删除'>×</button>"
        : "";
      return (
        "<div class='city-tag'>" +
        "<span><strong>" + city.name + "</strong> " +
        "<span class='city-id'>" + city.id + "</span></span>" +
        dataBadge + removeBtn +
        "</div>"
      );
    }).join("");

    container.querySelectorAll(".btn-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        deleteCity(btn.getAttribute("data-id"));
      });
    });
  }

  function renderSearchResults(results) {
    var container = document.getElementById("searchResults");
    if (!results.length) {
      container.innerHTML = "";
      setCityStatus("未找到匹配城市。请尝试输入省会/地级市全称，如：长沙、青岛、苏州。", "error");
      return;
    }

    container.innerHTML = results.map(function (item, index) {
      var sourceTag = item._source === "local"
        ? "<span class='source-tag source-local'>精确匹配</span>"
        : "<span class='source-tag source-api'>网络匹配</span>";
      var levelText = item.level ? item.level + " · " : "";
      var payload = buildCityPayload(item);
      var already = isCityConfigured(payload.id);
      var btnLabel = already ? "已添加" : "添加";
      var btnClass = already ? "btn btn-secondary" : "btn btn-primary";
      var btnDisabled = already ? " disabled" : "";
      return (
        "<div class='search-result-item'>" +
        "<div class='search-result-info'>" +
        "<strong>" + (item.displayName || item.name) + "</strong> " + sourceTag + "<br>" +
        "<small>" + levelText + (item.province || "") +
        " · " + item.latitude.toFixed(2) + "°N, " + item.longitude.toFixed(2) + "°E</small>" +
        "</div>" +
        "<button type='button' class='" + btnClass + " btn-add-city' data-index='" + index + "'" + btnDisabled + ">" + btnLabel + "</button>" +
        "</div>"
      );
    }).join("");

    container._results = results;
    lastSearchResults = results;
    updateQuickAddButton();

    var localCount = results.filter(function (r) { return r._source === "local"; }).length;
    var best = getBestMatch(results);
    var tip = best
      ? "点击绿色「一键添加」或右侧「添加」按钮。"
      : "列表中的城市均已添加。";
    if (localCount > 0 && best) {
      tip = "已匹配权威坐标，" + tip;
    }
    setCityStatus("找到 " + results.length + " 个结果。" + tip, "success");
  }

  function searchCity() {
    var keyword = document.getElementById("citySearchInput").value.trim();
    if (!keyword) {
      setCityStatus("请输入城市名称。", "error");
      return;
    }

    setCityStatus("正在搜索...", "info");
    var localResults = searchLocalCities(keyword);

    var url = "https://geocoding-api.open-meteo.com/v1/search?name=" +
      encodeURIComponent(normalizeKeyword(keyword)) + "&count=15&language=zh&countryCode=CN";

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var apiResults = filterApiResults(keyword, data.results || []);
        var merged = mergeSearchResults(keyword, localResults, apiResults);
        renderSearchResults(merged);
      })
      .catch(function () {
        if (localResults.length) {
          renderSearchResults(localResults);
        } else {
          setCityStatus("搜索失败，请检查网络连接。", "error");
        }
      });
  }

  function postQuickAdd(payload) {
    return apiJson("/api/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(function () {
      return { ok: false, status: 0, body: { message: "无法连接服务器，请双击 start.bat" } };
    });
  }

  function addCityFromSearch(item, btnEl) {
    if (!item) {
      setCityStatus("没有可添加的城市，请先搜索。", "error");
      return;
    }

    var payload = buildCityPayload(item);
    var displayLabel = item.displayName || item.name;

    if (isCityConfigured(payload.id)) {
      setCityStatus("「" + displayLabel + "」已在列表中，正在重新爬取...", "info");
      return ensureApi().then(function () {
        return runCrawl(payload.id, true);
      }).catch(function (err) {
        setCityStatus(err.message, "error");
      });
    }

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = "添加中...";
    }
    var quickBtn = document.getElementById("quickAddBtn");
    if (quickBtn) quickBtn.disabled = true;

    setCityStatus("正在添加「" + displayLabel + "」并爬取数据，请稍候（约 5 秒）...", "info");

    ensureApi()
      .then(function () {
        return postQuickAdd(payload);
      })
      .then(function (result) {
        if (!result.ok) {
          if (result.status === 409) {
            payload.id = suggestCityId(item.name, item.geoId || ("dup_" + Date.now()));
            return postQuickAdd(payload);
          }
          throw new Error(result.body.message || "添加失败");
        }
        document.getElementById("citySearchInput").value = "";
        document.getElementById("searchResults").innerHTML = "";
        lastSearchResults = [];
        return syncUI(result.body.message + "，图表已更新。", "success", result.body).then(updateQuickAddButton);
      })
      .catch(function (err) {
        setCityStatus(err.message || "添加失败", "error");
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = "添加";
        }
        updateQuickAddButton();
      });
  }

  function quickAddBestMatch() {
    if (!lastBestMatch) {
      var keyword = document.getElementById("citySearchInput").value.trim();
      if (!keyword) {
        setCityStatus("请先输入城市名并搜索。", "error");
        return;
      }
      searchCity();
      setTimeout(function () {
        if (lastBestMatch) addCityFromSearch(lastBestMatch, document.getElementById("quickAddBtn"));
        else setCityStatus("未找到可添加的城市，或该城市已存在。", "error");
      }, 800);
      return;
    }
    addCityFromSearch(lastBestMatch, document.getElementById("quickAddBtn"));
  }

  function deleteCity(cityId) {
    if (!apiAvailable) return;
    var city = configuredCities.find(function (c) { return c.id === cityId; });
    var label = city ? city.name : cityId;
    if (!confirm("确定删除「" + label + "」吗？下方图表将同步移除该城市数据。")) return;

    setCityStatus("正在删除「" + label + "」...", "info");
    apiJson("/api/cities?id=" + encodeURIComponent(cityId), { method: "DELETE" })
      .then(function (result) {
        if (!result.ok) throw new Error(result.body.message || "删除失败");
        return syncUI(result.body.message, "success", result.body);
      })
      .catch(function (err) { setCityStatus(err.message, "error"); });
  }

  function runCrawl(cityId, updateStatus) {
    if (updateStatus === undefined) updateStatus = true;

    if (!apiAvailable) {
      if (updateStatus) setCityStatus("爬取数据需使用 py server.py 启动服务器。", "error");
      return Promise.reject(new Error("API 不可用"));
    }

    var crawlAllBtn = document.getElementById("crawlAllBtn");
    if (updateStatus && crawlAllBtn) crawlAllBtn.disabled = true;

    if (updateStatus) {
      var msg = cityId
        ? "正在爬取城市 " + cityId + "，请稍候（约 5 秒）..."
        : "正在爬取全部城市，请稍候（约 10～30 秒）...";
      setCityStatus(msg, "info");
    }

    return fetch("/api/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cityId ? { city_id: cityId } : {}),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.body.message + (result.body.detail ? "：" + result.body.detail : ""));
        }
        if (updateStatus) {
          return syncUI(result.body.message + " 页面已更新。", "success", result.body);
        }
        return syncUI(null, null, result.body);
      })
      .finally(function () {
        if (updateStatus && crawlAllBtn) crawlAllBtn.disabled = false;
      });
  }

  function initCityManager() {
    document.getElementById("citySearchBtn").addEventListener("click", searchCity);
    document.getElementById("citySearchInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") searchCity();
    });
    document.getElementById("quickAddBtn").addEventListener("click", quickAddBestMatch);
    document.getElementById("crawlAllBtn").addEventListener("click", function () {
      if (!confirm("将重新爬取全部已配置城市，耗时约 10～30 秒，是否继续？")) return;
      runCrawl(null, true);
    });

    document.getElementById("searchResults").addEventListener("click", function (e) {
      var btn = e.target.closest(".btn-add-city");
      if (btn && !btn.disabled) {
        var container = document.getElementById("searchResults");
        var item = container._results[parseInt(btn.getAttribute("data-index"), 10)];
        addCityFromSearch(item, btn);
        return;
      }
      var row = e.target.closest(".search-result-item");
      if (row && !e.target.closest("button")) {
        var addBtn = row.querySelector(".btn-add-city:not([disabled])");
        if (addBtn) addBtn.click();
      }
    });

    if (location.protocol === "file:") {
      updateApiWarning();
    }

    loadChinaCities().then(function () {
      return loadConfiguredCities();
    }).then(function () {
      checkNetworkStatus();
    });
  }

  // -------------------------------------------------------------------------
  // 初始化入口
  // -------------------------------------------------------------------------

  function init() {
    loadData(false)
      .then(function () {
        initCitySelector();
        initCompareCheckboxes();
        renderAll();

        document.getElementById("loadingOverlay").classList.add("hidden");
        bindRefreshButton();
        initCityManager();
        window.addEventListener("resize", handleResize);
      })
      .catch(function (err) {
        document.getElementById("loadingOverlay").innerHTML =
          "<p style='color:#ea4335;font-size:1rem;max-width:400px;text-align:center;padding:20px;'>" +
          "⚠️ " + err.message +
          "<br><br>请双击项目文件夹中的：<br><code style='background:#f0f4f8;padding:4px 8px;border-radius:4px;'>启动平台.bat</code>" +
          "<br><br>首次启动会自动爬取数据并打开浏览器。" +
          "</p>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

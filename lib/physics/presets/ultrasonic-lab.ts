/**
 * 自包含的超声波测距交互仿真。
 *
 * 输出一个**零外部依赖**的 HTML 文档：内联 CSS 与 JS，不请求任何 CDN，
 * 因此在完全离线的环境（评委现场断网、内网机房）中依然可用。
 *
 * 仿真模型与物理工作台里的 Lab 页共用同一套物理假设：
 * 发射脉冲 → 传播 → 反射 → 接收，噪声叠加在回波上。
 */

// 直连 identity（无依赖叶子模块），保持纯领域层不引入 `lib/school` 桶文件。
import { COURSE, SCHOOL } from '@/lib/school/identity';

/** 声速默认值（m/s）。 */
const DEFAULT_SPEED = 343;
/** 超声波频率（Hz）。 */
const CARRIER_HZ = 40_000;

/**
 * 生成仿真 HTML。
 *
 * 之所以在这里重写一遍波形仿真而不是复用 `simulateUltrasonicWaveform`：
 * 该函数是 TypeScript 模块，导出的 HTML 字符串无法在运行时 import。
 * 两处保持同一套公式（脉冲宽度、往返延时、指数衰减、噪声幅度）。
 */
export function buildUltrasonicLabHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>超声波测距虚拟仿真 · ${SCHOOL.college}</title>
<style>
  :root {
    --primary: #0369a1;
    --primary-strong: #075985;
    --primary-soft: #e0f2fe;
    --line: #cbd5e1;
    --text: #1e293b;
    --muted: #64748b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px;
    font-family: "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
    color: var(--text);
    background: #f8fafc;
    line-height: 1.6;
  }
  h1 { font-size: 17px; margin: 0 0 4px; }
  p.sub { margin: 0 0 16px; font-size: 12px; color: var(--muted); }
  .wrap { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
  @media (max-width: 720px) { .wrap { grid-template-columns: 1fr; } }
  .panel {
    background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 14px;
  }
  .field { margin-bottom: 14px; }
  .field label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
  .field b { font-variant-numeric: tabular-nums; color: var(--primary); }
  input[type=range] { width: 100%; accent-color: var(--primary); }
  .readout { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-bottom: 14px; }
  .tile { background: var(--primary-soft); border-radius: 8px; padding: 8px 10px; }
  .tile span { display: block; font-size: 10.5px; color: var(--muted); }
  .tile strong { font-size: 18px; font-variant-numeric: tabular-nums; color: var(--primary-strong); }
  svg { width: 100%; height: 180px; background: #fff; border: 1px solid var(--line); border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
  th, td { border: 1px solid var(--line); padding: 4px 6px; text-align: left; }
  th { background: #f1f5f9; font-weight: 600; }
  button {
    background: var(--primary); color: #fff; border: 0; border-radius: 8px;
    padding: 8px 14px; font-size: 13px; cursor: pointer; font-family: inherit;
  }
  button.ghost { background: #fff; color: var(--primary-strong); border: 1px solid var(--line); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .note { font-size: 11.5px; color: var(--muted); margin-top: 12px; }
  .legend { display: flex; gap: 14px; font-size: 11.5px; color: var(--muted); margin-top: 6px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; }
  .brand-bar { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    border-bottom: 2px solid var(--primary); padding-bottom: 8px; margin-bottom: 14px; }
  .brand-bar strong { color: var(--primary-strong); font-size: 14px; }
  .brand-bar span { color: var(--muted); font-size: 11.5px; }
  .brand-foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 11px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="brand-bar">
    <strong>${SCHOOL.college} · ${COURSE.name}</strong>
    <span>${COURSE.className} · ${COURSE.teacher}</span>
  </div>
  <h1>超声波测距 · 虚拟仿真</h1>
  <p class="sub">发射脉冲 → 传播 → 反射 → 接收 → 计时。调节参数观察回波时延与测量误差如何变化。${SCHOOL.college} · ${COURSE.name}</p>

  <div class="wrap">
    <div class="panel">
      <div class="field">
        <label for="d">目标距离 <b><span id="dv">1.20</span> m</b></label>
        <input id="d" type="range" min="0.2" max="5" step="0.05" value="1.2" />
      </div>
      <div class="field">
        <label for="v">声速 <b><span id="vv">343</span> m/s</b></label>
        <input id="v" type="range" min="280" max="360" step="1" value="343" />
      </div>
      <div class="field">
        <label for="r">反射率 <b><span id="rv">85</span> %</b></label>
        <input id="r" type="range" min="10" max="99" step="1" value="85" />
      </div>
      <div class="field">
        <label for="n">噪声 <b><span id="nv">3</span> %</b></label>
        <input id="n" type="range" min="0" max="25" step="1" value="3" />
      </div>
      <div class="row">
        <button id="run">运行仿真</button>
        <button id="clear" class="ghost">清空记录</button>
      </div>
      <p class="note">距离公式 d = v·t / 2。除以 2 的来源：脉冲往返总路程为 2d。</p>
    </div>

    <div class="panel">
      <div class="readout">
        <div class="tile"><span>回波时延</span><strong><span id="rt">—</span> ms</strong></div>
        <div class="tile"><span>测量距离</span><strong><span id="md">—</span> m</strong></div>
        <div class="tile"><span>相对误差</span><strong><span id="er">—</span> %</strong></div>
        <div class="tile"><span>信号质量</span><strong><span id="q">—</span></strong></div>
      </div>
      <svg id="wave" viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="超声波回波时域波形"></svg>
      <div class="legend">
        <span><span class="dot" style="background:#0369a1"></span>回波波形</span>
        <span><span class="dot" style="background:#e11d48"></span>回波到达时刻</span>
      </div>
      <table>
        <thead><tr><th>目标距离</th><th>测量距离</th><th>相对误差</th><th>信号质量</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <p class="note">仿真参数与器材清单为课程示例数据，非真实实验设备读数。</p>
    </div>
  </div>

<script>
(function () {
  var CARRIER_HZ = ${CARRIER_HZ};
  var SAMPLE_RATE = 200000;
  var TOTAL_MS = 24;
  var $ = function (id) { return document.getElementById(id); };

  function bind(slider, label, format) {
    var el = $(slider);
    var out = $(label);
    var sync = function () { out.textContent = format(el.value); };
    el.addEventListener('input', sync);
    sync();
  }
  bind('d', 'dv', function (v) { return Number(v).toFixed(2); });
  bind('v', 'vv', function (v) { return v; });
  bind('r', 'rv', function (v) { return v; });
  bind('n', 'nv', function (v) { return v; });

  function gaussian() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function run() {
    var distance = Number($('d').value);
    var speed = Number($('v').value);
    var reflectivity = Number($('r').value) / 100;
    var noisePercent = Number($('n').value) / 100;

    var echoMs = (2 * distance * 1000) / speed;
    var totalSamples = Math.floor((TOTAL_MS / 1000) * SAMPLE_RATE);
    var echoSample = Math.floor((echoMs / 1000) * SAMPLE_RATE);
    var pulseSamples = Math.floor((8 / CARRIER_HZ) * SAMPLE_RATE);

    var points = [];
    var peak = 0;
    var raw = new Float64Array(totalSamples);

    for (var i = 0; i < totalSamples; i++) {
      var t = i / SAMPLE_RATE;
      var value = 0;
      if (i < pulseSamples) {
        value = Math.sin(2 * Math.PI * CARRIER_HZ * t) * 0.85;
      }
      if (i >= echoSample && i < echoSample + pulseSamples) {
        var dt = (i - echoSample) / SAMPLE_RATE;
        var decay = Math.exp(-3.2 * dt);
        value += Math.sin(2 * Math.PI * CARRIER_HZ * t) * reflectivity * decay;
      }
      value += gaussian() * noisePercent * 0.5;
      raw[i] = value;
      if (Math.abs(value) > peak) peak = Math.abs(value);
    }

    // 峰值归一化后抽样绘制，避免 48k 点全部进入路径。
    var step = Math.max(1, Math.floor(totalSamples / 900));
    for (var j = 0; j < totalSamples; j += step) {
      var x = (j / totalSamples) * 1000;
      var y = 100 - (raw[j] / (peak || 1)) * 78;
      points.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    var echoX = (echoSample / totalSamples) * 1000;
    var svg = document.getElementById('wave');
    svg.innerHTML =
      '<polyline points="' + points.join(' ') + '" fill="none" stroke="#0369a1" stroke-width="1.4" />' +
      '<line x1="' + echoX.toFixed(1) + '" x2="' + echoX.toFixed(1) + '" y1="14" y2="186" stroke="#e11d48" stroke-width="1.4" stroke-dasharray="5 4" />' +
      '<line x1="0" x2="1000" y1="100" y2="100" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4" />';

    // 由回波到达时刻反推距离，并按信噪比加入计时抖动。
    var snr = reflectivity / Math.max(0.01, noisePercent);
    var jitterMs = noisePercent > 0 ? (0.9 / snr) * (Math.random() - 0.5) : 0;
    var measuredMs = echoMs + jitterMs;
    var measured = (measuredMs * speed) / 2000;
    var errorPercent = ((measured - distance) / distance) * 100;
    var quality = snr > 12 ? '良好' : snr > 4 ? '一般' : '较差';

    $('rt').textContent = measuredMs.toFixed(3);
    $('md').textContent = measured.toFixed(3);
    $('er').textContent = errorPercent.toFixed(2);
    $('q').textContent = quality;

    var tbody = document.getElementById('rows');
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + distance.toFixed(2) + ' m</td>' +
      '<td>' + measured.toFixed(3) + ' m</td>' +
      '<td>' + errorPercent.toFixed(2) + '%</td>' +
      '<td>' + quality + '</td>';
    tbody.insertBefore(tr, tbody.firstChild);
  }

  document.getElementById('run').addEventListener('click', run);
  document.getElementById('clear').addEventListener('click', function () {
    document.getElementById('rows').innerHTML = '';
  });
  run();
})();
</script>
  <div class="brand-foot">
    ${SCHOOL.college} · ${COURSE.name} · ${COURSE.className} —— 超声波测距虚拟仿真（离线自包含版）<br />
    本页参数与测量结果为课程示例数据，非真实实验记录；仿真模型为教学近似，不作为工程计量依据。
  </div>
</body>
</html>`;
}

'use client';

/**
 * 学生端 · 虚拟实验（超声波测距）。
 *
 * 物理模型来自移植的仿真函数（`simulateUltrasonicMeasurement`），
 * 覆盖发射脉冲、往返传播、接收衰减与噪声；测量记录进入学习报告。
 */

import * as React from 'react';
import { Activity, FlaskConical, Play, Save } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, MetricTile, PageHeader, SectionCard } from '@/components/physics/shared';
import { simulateUltrasonicMeasurement } from '@/lib/physics/engine';
import type { LabRecord } from '@/lib/physics/types';

/** 把波形序列画成 SVG 折线。 */
function Waveform({ time, amplitude }: { time: readonly number[]; amplitude: readonly number[] }) {
  const width = 640;
  const height = 160;
  const padding = 8;
  if (time.length === 0) return null;

  const maxTime = time[time.length - 1] || 1;
  const points = amplitude
    .map((value, index) => {
      const x = padding + (time[index] / maxTime) * (width - padding * 2);
      const y = height / 2 - value * (height / 2 - padding);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="超声波回波时域波形：包含发射脉冲、往返传播延时与接收端衰减回波"
      className="h-[160px] w-full"
    >
      <line
        x1={padding}
        x2={width - padding}
        y1={height / 2}
        y2={height / 2}
        className="stroke-border"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <polyline points={points} fill="none" className="stroke-primary" strokeWidth={1.5} />
    </svg>
  );
}

export function StudentLab() {
  const { state, update } = usePhysicsState();
  const [distance, setDistance] = React.useState(1.2);
  const [speed, setSpeed] = React.useState(343);
  const [reflectivity, setReflectivity] = React.useState(85);
  const [noise, setNoise] = React.useState(3);
  const [result, setResult] = React.useState<LabRecord | null>(null);
  const [saved, setSaved] = React.useState(false);

  const run = () => {
    const measurement = simulateUltrasonicMeasurement({
      distanceM: distance,
      speedMps: speed,
      reflectivity,
      noisePercent: noise,
    });
    const record: LabRecord = {
      ...measurement,
      timestamp: new Date().toISOString(),
    };
    setResult(record);
    setSaved(false);
  };

  const save = () => {
    if (!result) return;
    update({ labRecords: [...state.labRecords, result] });
    setSaved(true);
  };

  const records = state.labRecords;
  const errors = records.map((record) => record.errorPercent);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="虚拟实验 · 超声波测距"
        description="发射脉冲 → 传播 → 反射 → 接收 → 计时。改变参数观察回波时延与测量误差如何变化。"
        actions={
          <Badge variant="secondary" className="font-normal">
            已记录 {records.length} 组
          </Badge>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <SectionCard title="实验参数">
          <div className="flex flex-col gap-5">
            <ParamSlider
              label="目标距离"
              unit="m"
              value={distance}
              min={0.2}
              max={5}
              step={0.05}
              hint="被测障碍物到换能器的距离"
              onChange={setDistance}
            />
            <ParamSlider
              label="声速"
              unit="m/s"
              value={speed}
              min={280}
              max={360}
              step={1}
              hint="常温约 343 m/s，温度变化会影响测距"
              onChange={setSpeed}
            />
            <ParamSlider
              label="反射率"
              unit="%"
              value={reflectivity}
              min={10}
              max={99}
              step={1}
              hint="回波强度，越低信噪比越差"
              onChange={setReflectivity}
            />
            <ParamSlider
              label="噪声"
              unit="%"
              value={noise}
              min={0}
              max={25}
              step={1}
              hint="环境干扰强度"
              onChange={setNoise}
            />
          </div>
          <div className="mt-5 flex gap-2">
            <Button onClick={run} className="flex-1">
              <Play className="size-4" />
              运行实验
            </Button>
            <Button variant="outline" onClick={save} disabled={!result || saved}>
              <Save className="size-4" />
              {saved ? '已记录' : '保存记录'}
            </Button>
          </div>
        </SectionCard>

        <div className="flex flex-col gap-5">
          {result ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricTile label="真实距离" value={result.distanceM.toFixed(3)} unit="m" />
                <MetricTile label="测量距离" value={result.measuredDistanceM.toFixed(3)} unit="m" />
                <MetricTile
                  label="相对误差"
                  value={result.errorPercent.toFixed(2)}
                  unit="%"
                  tone={
                    result.errorPercent < 2
                      ? 'success'
                      : result.errorPercent < 6
                        ? 'warning'
                        : 'danger'
                  }
                />
                <MetricTile
                  label="回波时延"
                  value={result.echoTimeMs.toFixed(3)}
                  unit="ms"
                  hint={`信号质量：${result.quality}`}
                />
              </div>

              <SectionCard
                title="回波时域波形"
                description="发射脉冲 → 往返传播延时 → 接收端衰减回波"
              >
                <Waveform time={result.waveform.time} amplitude={result.waveform.amplitude} />
                <div className="mt-2 flex flex-wrap justify-between text-[11px] text-muted-foreground">
                  <span>0 ms</span>
                  <span>
                    采样率 {(result.waveform.sampleRateHz / 1000).toFixed(0)} kHz · 总时长{' '}
                    {result.waveform.totalMs.toFixed(2)} ms
                  </span>
                  <span>{(result.waveform.totalMs || 0).toFixed(2)} ms</span>
                </div>
              </SectionCard>
            </>
          ) : (
            <SectionCard title="实验台">
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <FlaskConical className="size-8 text-primary" aria-hidden="true" />
                <p className="text-[13px] text-muted-foreground">
                  设置左侧参数后点击「运行实验」，即可看到回波波形与误差。
                </p>
              </div>
            </SectionCard>
          )}

          {records.length > 0 ? (
            <SectionCard title="测量记录" description="历次实验的误差分布">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-4 text-[12.5px]">
                  <span>
                    共 <strong>{records.length}</strong> 组
                  </span>
                  <span>
                    平均误差{' '}
                    <strong>
                      {(errors.reduce((sum, value) => sum + value, 0) / errors.length).toFixed(2)}
                    </strong>{' '}
                    %
                  </span>
                  <span>
                    最大误差 <strong>{Math.max(...errors).toFixed(2)}</strong> %
                  </span>
                </div>
                <ul className="flex flex-col gap-1">
                  {records
                    .slice()
                    .reverse()
                    .slice(0, 8)
                    .map((record, index) => (
                      <li
                        key={`${record.timestamp}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-[12px]"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          {record.distanceM.toFixed(2)} m
                        </span>
                        <span className="text-muted-foreground">
                          实测 {record.measuredDistanceM.toFixed(3)} m · 误差{' '}
                          {record.errorPercent.toFixed(2)}% · {record.quality}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>

      <HintBar>
        虚拟实验的仿真参数与器材清单为<strong>课程示例数据</strong>；
        实验结论的关键是「误差从哪来」，而不是「读数多准」。
      </HintBar>
    </div>
  );
}

function ParamSlider({
  label,
  unit,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[12.5px] font-medium">{label}</label>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {value} {unit}
        </span>
      </div>
      <Slider
        className="mt-2"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onChange(next[0] ?? value)}
        aria-label={`${label}（${unit}）`}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

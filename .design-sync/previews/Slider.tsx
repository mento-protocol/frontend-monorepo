import { Slider } from "@mento-protocol/ui";

export const SliderLow = () => (
  <Slider defaultValue={[20]} max={100} step={1} style={{ width: 260 }} />
);

export const SliderMid = () => (
  <Slider defaultValue={[50]} max={100} step={1} style={{ width: 260 }} />
);

export const SliderHigh = () => (
  <Slider defaultValue={[85]} max={100} step={1} style={{ width: 260 }} />
);

export const SliderDisabled = () => (
  <Slider
    defaultValue={[50]}
    max={100}
    step={1}
    disabled
    style={{ width: 260 }}
  />
);

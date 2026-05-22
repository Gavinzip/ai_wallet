import Svg, { Path } from "react-native-svg";

type MiniSparklineProps = {
  data: number[];
  color: string;
};

export function MiniSparkline({ color, data }: MiniSparklineProps) {
  const width = 78;
  const height = 34;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = Math.max(max - min, 1);
  const step = width / Math.max(data.length - 1, 1);
  const path = data
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 6) - 3;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <Svg height={height} width={width}>
      <Path
        d={path}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
      />
    </Svg>
  );
}

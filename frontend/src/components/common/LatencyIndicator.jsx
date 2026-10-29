import React from 'react';

export const LatencyIndicator = ({ latencyMs }) => {
  if (latencyMs === null || latencyMs === undefined) {
    return <span className="latency-pill">—</span>;
  }

  let speedClass = 'fast';
  if (latencyMs > 100) speedClass = 'slow';
  else if (latencyMs > 40) speedClass = 'medium';

  return (
    <span className={`latency-pill ${speedClass}`}>
      {latencyMs} ms
    </span>
  );
};

export default LatencyIndicator;

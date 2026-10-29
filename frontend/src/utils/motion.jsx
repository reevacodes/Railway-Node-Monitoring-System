import React, { useState, useEffect, useRef } from 'react';

/**
 * useCountUp hook
 * Smoothly animates numbers from previous to new value.
 * Avoids replaying when value is unchanged across polling intervals.
 */
export function useCountUp(targetValue, duration = 800) {
  const [displayValue, setDisplayValue] = useState(
    typeof targetValue === 'number' ? targetValue : 0
  );
  const prevValueRef = useRef(typeof targetValue === 'number' ? targetValue : 0);
  const animFrameRef = useRef(null);

  useEffect(() => {
    if (typeof targetValue !== 'number' || isNaN(targetValue)) {
      return;
    }

    const startValue = prevValueRef.current;
    const endValue = targetValue;

    // If unchanged, don't replay
    if (startValue === endValue) {
      setDisplayValue(endValue);
      return;
    }

    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setDisplayValue(endValue);
      prevValueRef.current = endValue;
      return;
    }

    const startTime = performance.now();

    const updateCounter = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + (endValue - startValue) * easeOut);

      setDisplayValue(current);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(updateCounter);
      } else {
        setDisplayValue(endValue);
        prevValueRef.current = endValue;
      }
    };

    animFrameRef.current = requestAnimationFrame(updateCounter);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [targetValue, duration]);

  return displayValue;
}

/**
 * AnimatedCounter component for numbers and percentages
 */
export const AnimatedCounter = ({ value, suffix = '', prefix = '', duration = 700 }) => {
  const isNumber = typeof value === 'number' && !isNaN(value);
  const animated = useCountUp(isNumber ? value : 0, duration);

  if (!isNumber) {
    return <span>{value ?? '—'}</span>;
  }

  return (
    <span>
      {prefix}
      {animated.toLocaleString()}
      {suffix}
    </span>
  );
};

/**
 * Skeleton Loader matching dark NOC theme
 */
export const Skeleton = ({ width = '100%', height = '16px', borderRadius = '4px', className = '', style = {} }) => {
  return (
    <div
      className={`skeleton-loader ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
};

export default {
  useCountUp,
  AnimatedCounter,
  Skeleton,
};

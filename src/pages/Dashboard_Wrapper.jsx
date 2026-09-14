import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { useSpring, animated } from 'react-spring';

const Dashboard_Wrapper = forwardRef(({ children }, ref) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const isTransitioning = useRef(false);
  const transitionTimeoutRef = useRef(null);
  const totalSections = React.Children.count(children);

  const [styles, api] = useSpring(() => ({
    y: 0,
    config: { mass: 1, tension: 180, friction: 26 }
  }));

  const scrollToSection = (index) => {
    if (index < 0 || index >= totalSections) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    isTransitioning.current = true;

    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    transitionTimeoutRef.current = setTimeout(() => {
      isTransitioning.current = false;
    }, 500);

    api.start({
      y: -index * 100,
      onRest: () => {
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
        }
        isTransitioning.current = false;
      }
    });
  };

  useImperativeHandle(ref, () => ({
    scrollToSection
  }));

  // Auto-recover and re-align view on window restore, maximize, or resize
  useEffect(() => {
    const handleSync = () => {
      isTransitioning.current = false;
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      api.set({ y: -activeIndexRef.current * 100 });
    };

    window.addEventListener('resize', handleSync);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('resize', handleSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [api]);

  const isTargetingInteractiveUI = (event, direction = 0) => {
    if (!event || !event.target) return false;
    
    // Only target actual map viewport, not Chart.js canvas elements
    const isMap = !!event.target.closest('.ol-viewport');
    const isPopover = !!(
      event.target.closest('[data-radix-popper-content-wrapper]') || 
      event.target.closest('[role="dialog"]') ||
      event.target.tagName === 'SELECT' ||
      event.target.tagName === 'OPTION'
    );

    if (isMap || isPopover) return true;

    const scrollableParent = event.target.closest('.overflow-y-auto, .overflow-auto, [data-scrollable="true"], tbody');
    
    if (scrollableParent) {
      const { scrollTop, scrollHeight, clientHeight } = scrollableParent;
      const canScrollDown = scrollHeight - clientHeight > 1 && scrollTop + clientHeight < scrollHeight - 2;
      const canScrollUp = scrollHeight - clientHeight > 1 && scrollTop > 2;

      if (direction > 0 && canScrollDown) return true;
      if (direction < 0 && canScrollUp) return true;
    }

    return false;
  };

  const bind = useGesture(
    {
      onWheel: ({ velocity: [, vy], direction: [, dy], event }) => {
        if (isTargetingInteractiveUI(event, dy)) return;
        if (isTransitioning.current || vy < 0.3) return;
        
        const currentIndex = activeIndexRef.current;
        if (dy > 0) {
          scrollToSection(currentIndex + 1);
        } else if (dy < 0) {
          scrollToSection(currentIndex - 1);
        }
      },
      onDrag: ({ velocity: [, vy], direction: [, dy], last, event }) => {
        const moveDir = dy < 0 ? 1 : dy > 0 ? -1 : 0;
        if (isTargetingInteractiveUI(event, moveDir)) return;
        if (!last || isTransitioning.current || vy < 0.3) return;

        const currentIndex = activeIndexRef.current;
        if (dy < 0) {
          scrollToSection(currentIndex + 1);
        } else if (dy > 0) {
          scrollToSection(currentIndex - 1);
        }
      }
    },
    { 
      wheel: { eventOptions: { passive: false } },
      drag: { filterTaps: true }
    }
  );

  return (
    <div 
      {...bind()} 
      className="w-full h-full overflow-hidden bg-transparent text-slate-800 touch-none select-none"
    >
      <animated.div 
        style={{ transform: styles.y.to(y => `translateY(${y}%)`) }}
        className="w-full h-full flex flex-col m-0 p-0"
      >
        {React.Children.map(children, (child) => (
          <div className="w-full h-full flex-shrink-0 overflow-hidden box-border">
            {child}
          </div>
        ))}
      </animated.div>
    </div>
  );
});

Dashboard_Wrapper.displayName = 'Dashboard_Wrapper';
export default Dashboard_Wrapper;
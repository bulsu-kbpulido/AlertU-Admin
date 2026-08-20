import React, { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { useSpring, animated } from 'react-spring';

const Dashboard_Wrapper = forwardRef(({ children }, ref) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const isTransitioning = useRef(false);
  const totalSections = React.Children.count(children);

  const [styles, api] = useSpring(() => ({
    y: 0,
    config: { mass: 1, tension: 180, friction: 26 }
  }));

  const scrollToSection = (index) => {
    if (index < 0 || index >= totalSections) return;
    setActiveIndex(index);
    isTransitioning.current = true;
    
    api.start({
      y: -index * 100,
      onRest: () => {
        isTransitioning.current = false;
      }
    });
  };

  useImperativeHandle(ref, () => ({
    scrollToSection
  }));

  const isTargetingInteractiveUI = (event) => {
    if (!event || !event.target) return false;
    
    const isMap = event.target.closest('.ol-viewport') || event.target.tagName === 'CANVAS';
    const isPopover = event.target.closest('[data-radix-popper-content-wrapper]') || 
                      event.target.closest('[role="dialog"]') ||
                      event.target.tagName === 'SELECT' ||
                      event.target.tagName === 'OPTION';

    const scrollableParent = event.target.closest('.overflow-y-auto, .overflow-auto, [data-scrollable="true"], tbody');
    
    let isScrollable = false;
    if (scrollableParent) {
      const { scrollHeight, clientHeight } = scrollableParent;
      isScrollable = scrollHeight > clientHeight;
    }

    return isMap || isPopover || isScrollable;
  };

  const bind = useGesture(
    {
      onWheel: ({ velocity: [, vy], direction: [, dy], event }) => {
        if (isTargetingInteractiveUI(event)) return;
        if (isTransitioning.current || vy < 0.3) return;
        
        if (dy > 0) {
          scrollToSection(activeIndex + 1);
        } else if (dy < 0) {
          scrollToSection(activeIndex - 1);
        }
      },
      onDrag: ({ velocity: [, vy], direction: [, dy], last, event }) => {
        if (isTargetingInteractiveUI(event)) return;
        if (!last || isTransitioning.current || vy < 0.3) return;

        if (dy < 0) {
          scrollToSection(activeIndex + 1);
        } else if (dy > 0) {
          scrollToSection(activeIndex - 1);
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
      className="w-full h-screen overflow-hidden bg-transparent text-slate-800 touch-none select-none"
    >
      <animated.div 
        style={{ transform: styles.y.to(y => `translateY(${y}vh)`) }}
        className="w-full h-full flex flex-col m-0 p-0"
      >
        {React.Children.map(children, (child) => (
          <div className="w-full h-screen h-[100vh] flex-shrink-0 overflow-hidden box-border">
            {child}
          </div>
        ))}
      </animated.div>
    </div>
  );
});

Dashboard_Wrapper.displayName = 'Dashboard_Wrapper';
export default Dashboard_Wrapper;
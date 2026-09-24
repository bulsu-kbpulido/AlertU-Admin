import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
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

  // Navigation between subsections is now click/route-driven only (via
  // scrollToSection, called from Dashboard.jsx on route change). The
  // previous wheel/drag gesture handling that snapped between sections
  // on scroll has been removed so normal scrolling inside each section
  // (overflow-y-auto panels, tables, etc.) never gets intercepted.

  return (
    <div 
      className="w-full h-full overflow-hidden bg-transparent text-slate-800"
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

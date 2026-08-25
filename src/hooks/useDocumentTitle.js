import { useEffect } from 'react';

/**
 * Custom hook to dynamically update the document.title in the browser tab.
 * @param {string} title - The title to display (e.g., 'Dashboard – AlertU')
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    if (title) {
      document.title = title;
    }
  }, [title]);
}

export default useDocumentTitle;

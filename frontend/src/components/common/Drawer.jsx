import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export const Drawer = ({ isOpen, onClose, title, children, width = 500 }) => {
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose?.();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e) => {
    if (e.target === e.currentTarget) {
      backdropMouseDownRef.current = true;
    } else {
      backdropMouseDownRef.current = false;
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget && backdropMouseDownRef.current) {
      backdropMouseDownRef.current = false;
      onClose?.();
    }
    backdropMouseDownRef.current = false;
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="drawer-panel"
        style={{ maxWidth: `${width}px` }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <h3 style={{ fontSize: '13.5px', fontWeight: 600 }}>{title}</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
};

export default Drawer;


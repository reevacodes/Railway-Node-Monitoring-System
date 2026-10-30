import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export const Modal = ({ isOpen, onClose, title, children, maxWidth = 520 }) => {
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
    // Only flag as true if the mousedown was directly on the backdrop itself
    if (e.target === e.currentTarget) {
      backdropMouseDownRef.current = true;
    } else {
      backdropMouseDownRef.current = false;
    }
  };

  const handleBackdropClick = (e) => {
    // Only close if BOTH mousedown and click originated and completed directly on the backdrop.
    // This prevents clicks from triggering on the backdrop when opening via button, dragging text,
    // or selecting items in dropdowns.
    if (e.target === e.currentTarget && backdropMouseDownRef.current) {
      backdropMouseDownRef.current = false;
      onClose?.();
    }
    backdropMouseDownRef.current = false;
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="modal-card"
        style={{ maxWidth: `${maxWidth}px` }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};

export default Modal;


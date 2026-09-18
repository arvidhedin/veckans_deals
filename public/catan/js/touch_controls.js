/**
 * Touch Controls: Smooth Pan & Pinch-to-Zoom Engine for Catan Board
 * Handles touch gestures on mobile and mouse interactions on desktop.
 */

class TouchControls {
  constructor(containerId, rootGroupId) {
    this.container = document.getElementById(containerId);
    this.rootGroup = document.getElementById(rootGroupId);

    this.scale = 1.0;
    this.minScale = 0.55;
    this.maxScale = 3.0;

    this.translateX = 0;
    this.translateY = 0;

    // Gesture state
    this.isDragging = false;
    this.lastTouchX = 0;
    this.lastTouchY = 0;
    this.initialPinchDistance = null;
    this.initialPinchScale = 1.0;

    this._bindEvents();
    this.resetView();
  }

  _bindEvents() {
    if (!this.container) return;

    // --- Touch Events (Mobile) ---
    this.container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastTouchX = e.touches[0].clientX;
        this.lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        this.initialPinchDistance = this._getTouchDistance(e.touches[0], e.touches[1]);
        this.initialPinchScale = this.scale;
      }
    }, { passive: false });

    this.container.addEventListener('touchmove', (e) => {
      e.preventDefault(); // Prevent native browser bounce/scroll

      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.lastTouchX;
        const dy = e.touches[0].clientY - this.lastTouchY;
        this.lastTouchX = e.touches[0].clientX;
        this.lastTouchY = e.touches[0].clientY;

        this.translateX += dx;
        this.translateY += dy;
        this._updateTransform();
      } else if (e.touches.length === 2 && this.initialPinchDistance) {
        const currentDist = this._getTouchDistance(e.touches[0], e.touches[1]);
        const pinchRatio = currentDist / this.initialPinchDistance;
        let newScale = this.initialPinchScale * pinchRatio;
        this.setScale(newScale);
      }
    }, { passive: false });

    this.container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        this.initialPinchDistance = null;
      }
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastTouchX = e.touches[0].clientX;
        this.lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 0) {
        this.isDragging = false;
      }
    });

    // --- Mouse Events (Desktop) ---
    this.container.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        this.isDragging = true;
        this.lastTouchX = e.clientX;
        this.lastTouchY = e.clientY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.lastTouchX;
        const dy = e.clientY - this.lastTouchY;
        this.lastTouchX = e.clientX;
        this.lastTouchY = e.clientY;

        this.translateX += dx;
        this.translateY += dy;
        this._updateTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Wheel zoom
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      this.setScale(this.scale * zoomFactor);
    }, { passive: false });

    // Header buttons
    const btnIn = document.getElementById('btn-zoom-in');
    const btnOut = document.getElementById('btn-zoom-out');
    const btnReset = document.getElementById('btn-reset-zoom');

    if (btnIn) btnIn.addEventListener('click', () => this.zoomBy(1.2));
    if (btnOut) btnOut.addEventListener('click', () => this.zoomBy(0.8));
    if (btnReset) btnReset.addEventListener('click', () => this.resetView());
  }

  _getTouchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  setScale(newScale) {
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, newScale));
    this._updateTransform();
  }

  zoomBy(multiplier) {
    this.setScale(this.scale * multiplier);
  }

  resetView() {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.translateX = rect.width / 2;
    this.translateY = rect.height / 2;
    
    // On small mobile screens, start slightly zoomed out for mega board
    const isMobile = window.innerWidth <= 600;
    this.scale = isMobile ? 0.82 : 1.05;
    this._updateTransform();
  }

  _updateTransform() {
    if (!this.rootGroup) return;
    this.rootGroup.setAttribute(
      'transform',
      `translate(${this.translateX.toFixed(1)}, ${this.translateY.toFixed(1)}) scale(${this.scale.toFixed(3)})`
    );
  }
}

window.TouchControls = TouchControls;

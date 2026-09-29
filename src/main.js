import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';

gsap.registerPlugin(ScrollTrigger);

// ==========================================================================
// RENDERER SETUP
// ==========================================================================
const canvas = document.getElementById('hero-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance'
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.64;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ==========================================================================
// SCENE & CAMERA
// ==========================================================================
const scene = new THREE.Scene();
const aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(32, aspect, 0.1, 200);
camera.position.set(0, 0, 5.5);

// Environment setup for high quality reflections
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

// Lighting setup
const ambientLight = new THREE.AmbientLight(0xfff0dd, 0.55);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffeedd, 1.6);
keyLight.position.set(-2, 4, 5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xf5e8d0, 0.35);
fillLight.position.set(4, 1, -2);
scene.add(fillLight);

const hemiLight = new THREE.HemisphereLight(0xfff0dd, 0xcfc0ae, 0.4);
scene.add(hemiLight);

// ==========================================================================
// BALL WAYPOINTS & STATE
// ==========================================================================
const BALL_SCALE = 0.97;
const FOOTER_SCALE = 0.5;

const SECTIONS = {
  hero:   { x:  0.5,  y: -0.45, z:  0,    scale: BALL_SCALE   },
  stats:  { x:  2.2,  y:  0.0,  z:  0,    scale: BALL_SCALE   },
  how:    { x: -2.2,  y:  0.0,  z:  0,    scale: BALL_SCALE   },
  footer: { x:  2.5,  y: -1.3,  z: -2.0,  scale: FOOTER_SCALE },
};

let ball = null;
let baseScale = 1.0;
let ballLoaded = false;
let currentSection = 'hero';
let isDragging = false;
let dragEnabled = false;

// Auto-rotation parameters
const BASE_SPEED = 0.003;
let autoVel = {
  x: (Math.random() - 0.5) * 0.003,
  y: BASE_SPEED + Math.random() * 0.002,
};

let previousMousePosition = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 };
const DAMPING = 0.94;

// ==========================================================================
// PROCEDURAL BASKETBALL CREATOR (Fallback if GLB missing)
// ==========================================================================
function createProceduralBasketball() {
  const group = new THREE.Group();
  
  // Canvas for realistic basketball pebbled texture + seam lines
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 1024;
  texCanvas.height = 512;
  const ctx = texCanvas.getContext('2d');

  // Base leather color
  ctx.fillStyle = '#D9531E';
  ctx.fillRect(0, 0, texCanvas.width, texCanvas.height);

  // Noise pebbles
  for (let i = 0; i < 40000; i++) {
    const px = Math.random() * texCanvas.width;
    const py = Math.random() * texCanvas.height;
    const size = Math.random() * 1.5 + 0.5;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }

  // Black seam lines
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 12;

  // Horizontal centerline
  ctx.beginPath();
  ctx.moveTo(0, texCanvas.height / 2);
  ctx.lineTo(texCanvas.width, texCanvas.height / 2);
  ctx.stroke();

  // Vertical seams
  ctx.beginPath();
  ctx.moveTo(texCanvas.width * 0.25, 0);
  ctx.lineTo(texCanvas.width * 0.25, texCanvas.height);
  ctx.moveTo(texCanvas.width * 0.75, 0);
  ctx.lineTo(texCanvas.width * 0.75, texCanvas.height);
  ctx.stroke();

  // Curved side seams
  ctx.beginPath();
  ctx.ellipse(texCanvas.width * 0.5, texCanvas.height * 0.5, 180, 200, 0, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(texCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const sphereGeo = new THREE.SphereGeometry(1.2, 64, 64);
  const sphereMat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 0.15
  });

  const sphere = new THREE.Mesh(sphereGeo, sphereMat);
  group.add(sphere);
  return group;
}

// ==========================================================================
// 3D MODEL LOADING
// ==========================================================================
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

function initBall(modelGroup) {
  ball = modelGroup;
  
  // Center mesh
  const box = new THREE.Box3().setFromObject(ball);
  ball.position.sub(box.getCenter(new THREE.Vector3()));
  
  // Normalize scale so longest axis = 2.4 units
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 2.4;
  baseScale = 2.4 / maxDim;
  
  // Apply initial hero section placement & scale
  ball.scale.setScalar(baseScale * SECTIONS.hero.scale);
  ball.position.set(SECTIONS.hero.x, SECTIONS.hero.y - 0.8, SECTIONS.hero.z); // start offset down for entrance
  
  // Gritty street material overrides
  ball.traverse((child) => {
    if (child.isMesh && child.material) {
      const m = child.material;
      m.envMapIntensity = 0.15;
      if (m.roughness !== undefined) m.roughness = Math.min(1.0, Math.max(0.82, (m.roughness ?? 0.5) * 1.55));
      if (m.metalness !== undefined) m.metalness = 0;
      if (m.color) m.color.multiplyScalar(0.68); // Darker, grittier texture
      m.needsUpdate = true;
    }
  });

  scene.add(ball);
  ballLoaded = true;
  ballEntranceAnimation();
}

// Attempt to load GLB file with procedural fallback
fetch('/models/basketball.glb', { method: 'HEAD' })
  .then((res) => {
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html')) {
      loader.load(
        '/models/basketball.glb',
        (gltf) => {
          initBall(gltf.scene);
        },
        undefined,
        () => {
          initBall(createProceduralBasketball());
        }
      );
    } else {
      initBall(createProceduralBasketball());
    }
  })
  .catch(() => {
    initBall(createProceduralBasketball());
  });


// ==========================================================================
// ENTRANCE ANIMATION
// ==========================================================================
function ballEntranceAnimation() {
  if (!ball) return;
  
  // Scale & position entry animation
  gsap.fromTo(
    ball.scale,
    { x: baseScale * SECTIONS.hero.scale * 0.25, y: baseScale * SECTIONS.hero.scale * 0.25, z: baseScale * SECTIONS.hero.scale * 0.25 },
    {
      x: baseScale * SECTIONS.hero.scale,
      y: baseScale * SECTIONS.hero.scale,
      z: baseScale * SECTIONS.hero.scale,
      duration: 1.3,
      delay: 0.5,
      ease: 'expo.out',
    }
  );

  gsap.to(ball.position, {
    y: SECTIONS.hero.y,
    duration: 1.3,
    delay: 0.5,
    ease: 'expo.out',
    onComplete: () => {
      enableDrag();
    }
  });
}

// ==========================================================================
// DRAG & MOMENTUM PHYSICS
// ==========================================================================
function enableDrag() {
  dragEnabled = true;
  if (currentSection === 'hero') {
    canvas.classList.add('drag-enabled');
  }
}

function disableDrag() {
  dragEnabled = false;
  canvas.classList.remove('drag-enabled');
}

function onPointerDown(e) {
  if (!dragEnabled || currentSection !== 'hero') return;
  isDragging = true;
  previousMousePosition = {
    x: e.clientX || (e.touches && e.touches[0].clientX) || 0,
    y: e.clientY || (e.touches && e.touches[0].clientY) || 0,
  };
  velocity = { x: 0, y: 0 };
}

function onPointerMove(e) {
  if (!isDragging || !ball) return;
  const currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
  const currentY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

  const deltaX = currentX - previousMousePosition.x;
  const deltaY = currentY - previousMousePosition.y;

  velocity.x = deltaY * 0.006;
  velocity.y = deltaX * 0.006;

  ball.rotation.x += velocity.x;
  ball.rotation.y += velocity.y;

  previousMousePosition = { x: currentX, y: currentY };
}

function onPointerUp() {
  if (!isDragging) return;
  isDragging = false;

  // Set new auto-rotation direction derived from drag speed
  if (Math.abs(velocity.x) > 0.001 || Math.abs(velocity.y) > 0.001) {
    autoVel = {
      x: velocity.x * 0.4,
      y: velocity.y * 0.4,
    };
  }
}

window.addEventListener('mousedown', onPointerDown);
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);

window.addEventListener('touchstart', onPointerDown, { passive: true });
window.addEventListener('touchmove', onPointerMove, { passive: true });
window.addEventListener('touchend', onPointerUp);

// ==========================================================================
// SCROLL-DRIVEN 3D WAYPOINTS (GSAP ScrollTrigger)
// ==========================================================================
function setupScrollBall() {
  if (!ball) return;

  function updateBallPosition(fromSec, toSec, progress) {
    const easeProg = gsap.parseEase('power2.inOut')(progress);
    
    // Interpolate positions
    const curX = THREE.MathUtils.lerp(fromSec.x, toSec.x, easeProg);
    const curY = THREE.MathUtils.lerp(fromSec.y, toSec.y, easeProg);
    const curScale = THREE.MathUtils.lerp(fromSec.scale, toSec.scale, easeProg);
    
    // Add subtle arc depth offset
    const depthOffset = -Math.sin(progress * Math.PI) * 0.4;
    const curZ = THREE.MathUtils.lerp(fromSec.z, toSec.z, easeProg) + depthOffset;

    ball.position.set(curX, curY, curZ);
    ball.scale.setScalar(baseScale * curScale);
  }

  // Hero -> Stats
  ScrollTrigger.create({
    trigger: '#stats-section',
    start: 'top bottom',
    end: 'top top',
    scrub: 2,
    onUpdate: (self) => {
      updateBallPosition(SECTIONS.hero, SECTIONS.stats, self.progress);
    },
    onEnter: () => {
      currentSection = 'stats';
      disableDrag();
    },
    onLeaveBack: () => {
      currentSection = 'hero';
      enableDrag();
    }
  });

  // Stats -> How
  ScrollTrigger.create({
    trigger: '#how-section',
    start: 'top bottom',
    end: 'top top',
    scrub: 2,
    onUpdate: (self) => {
      updateBallPosition(SECTIONS.stats, SECTIONS.how, self.progress);
    },
    onEnter: () => {
      currentSection = 'how';
      disableDrag();
    },
    onLeaveBack: () => {
      currentSection = 'stats';
      disableDrag();
    }
  });

  // How -> Footer
  ScrollTrigger.create({
    trigger: '#site-footer',
    start: 'top bottom',
    end: 'top top',
    scrub: 2,
    onUpdate: (self) => {
      updateBallPosition(SECTIONS.how, SECTIONS.footer, self.progress);
    },
    onEnter: () => {
      currentSection = 'footer';
      disableDrag();
    },
    onLeaveBack: () => {
      currentSection = 'how';
      disableDrag();
    }
  });
}

// ==========================================================================
// GSAP UI ENTRANCE TIMELINE
// ==========================================================================
function initUIAnimations() {
  const tl = gsap.timeline({ delay: 0.15 });

  tl.to('.nav-logo', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.1)
    .to('.nav-links', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.15)
    .to('.profile-btn', { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.2)
    .to('#ph-badge', { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out' }, 0.4)
    .to('#event-card', { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out' }, 0.55)
    .to('#hero-text', { opacity: 1, x: 0, duration: 1.1, ease: 'expo.out' }, 0.65)
    .to('#nav-arrow', { opacity: 1, duration: 0.5, ease: 'power2.out' }, 1.1)
    .to('#sig-wrap', { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 1.2)
    .to('.sp1', { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut' }, 1.2)
    .to('.sp2', { strokeDashoffset: 0, duration: 1.0, ease: 'power2.inOut' }, 1.8)
    .to('.sp3', { strokeDashoffset: 0, duration: 0.7, ease: 'power2.inOut' }, 2.0);

  // Scroll triggers for stats section
  ScrollTrigger.create({
    trigger: '#stats-section',
    start: 'top 75%',
    onEnter: () => {
      gsap.to('.stat-card', {
        opacity: 1,
        y: 0,
        stagger: 0.1,
        duration: 0.8,
        ease: 'expo.out',
        delay: 0.1
      });
    }
  });

  // Scroll triggers for how section
  ScrollTrigger.create({
    trigger: '#how-section',
    start: 'top 70%',
    onEnter: () => {
      gsap.to('.step-item', {
        opacity: 1,
        x: 0,
        stagger: 0.15,
        duration: 0.9,
        ease: 'expo.out',
        delay: 0.1
      });
    }
  });

  // Event Card Hover GSAP Animation
  const eventCardEl = document.getElementById('event-card');
  if (eventCardEl) {
    eventCardEl.addEventListener('mouseenter', () => {
      gsap.to(eventCardEl, { scale: 1.035, y: -6, duration: 0.55, ease: 'power3.out', overwrite: 'auto' });
    });
    eventCardEl.addEventListener('mouseleave', () => {
      gsap.to(eventCardEl, { scale: 1.0, y: 0, duration: 0.55, ease: 'power3.out', overwrite: 'auto' });
    });
  }

  // Navbar scrolled class toggle
  window.addEventListener('scroll', () => {
    const nav = document.querySelector('.navbar');
    if (nav) {
      if (window.scrollY > 80) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }
  });

  // Arrow button click smooth scroll
  const navArrow = document.getElementById('nav-arrow');
  if (navArrow) {
    navArrow.addEventListener('click', () => {
      document.getElementById('stats-section')?.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

// ==========================================================================
// RENDER LOOP
// ==========================================================================
function animate() {
  requestAnimationFrame(animate);

  if (ball) {
    if (isDragging) {
      // Damping inertia
      velocity.x *= DAMPING;
      velocity.y *= DAMPING;
    } else {
      // Auto-rotation
      ball.rotation.x += autoVel.x;
      ball.rotation.y += autoVel.y;
    }
  }

  renderer.render(scene, camera);
}
animate();

// ==========================================================================
// WINDOW RESIZE HANDLER
// ==========================================================================
window.addEventListener('resize', () => {
  const newWidth = window.innerWidth;
  const newHeight = window.innerHeight;

  camera.aspect = newWidth / newHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(newWidth, newHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  ScrollTrigger.refresh();
});

// Initialize animations on DOM load
window.addEventListener('load', () => {
  setupScrollBall();
  initUIAnimations();
  ScrollTrigger.refresh();
});

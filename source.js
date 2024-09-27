// Import necessary libraries
import * as THREE from 'three';
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Global variables
let mindARInstance = null;
let experiences = [];
let experienceConfig; 
let lastExperience = null; // Track the last experience to prevent reloading
let chromaticAberrationPass, glowPass;

// Wait for the DOM to be fully loaded
window.addEventListener('DOMContentLoaded', async () => {
    // Ensure the DOM is ready, including the #mindar-container
    await new Promise(resolve => setTimeout(resolve, 100)); // Tiny delay to ensure readiness
    experienceConfig = await fetch("./experiences.json").then(res => res.json());
    experiences = experienceConfig.experiences;

    loadARExperience(experiences[0]);
    createThumbnailMenu(experienceConfig);

    // Site credits functionality
    const attribution = document.getElementById('attribution');
    const credits = document.getElementById('site-credits');

    // Toggle the visibility of the credits on click
    attribution.addEventListener('click', () => {
        credits.style.display = credits.style.display === 'none' || credits.style.display === '' ? 'block' : 'none';
    });
});

// Function to create the thumbnail menu
function createThumbnailMenu(config) {
    const menuContainer = document.getElementById('experience-menu'); 

    config.experiences.forEach(exp => {
        const thumbnail = document.createElement('img');
        thumbnail.src = `${config.basePath}${exp.folder}/${config.thumbsFile}`; 
        thumbnail.alt = exp.name;
        thumbnail.className = 'thumbnail'; 

        thumbnail.addEventListener('click', () => {
            loadARExperience(exp); 
        });

        menuContainer.appendChild(thumbnail); 
    });
}

async function disposeARSession() {
    if (mindARInstance) {
        console.log('Disposing of existing MindAR session...');

        try {
            await mindARInstance.stop();
            console.log('Session stopped');

            if (mindARInstance.renderer) {
                mindARInstance.renderer.forceContextLoss();
                console.log('Context loss forced');

                mindARInstance.renderer.dispose();
                console.log('Renderer disposed');

                mindARInstance.renderer.domElement = null;
                console.log('DOM element nullified');
            }
        } catch (error) {
            console.error('Error during disposal:', error);
        }

        mindARInstance = null;

        // Clear #mindar-container and remove UI overlays
        const mindarContainer = document.querySelector("#mindar-container");
        if (mindarContainer) {
            mindarContainer.innerHTML = ''; // Clear container
        }

        // Remove any lingering UI overlays
        document.querySelectorAll('.mindar-ui-overlay').forEach(overlay => overlay.remove());

        console.log('MindAR container and overlays cleared');
    }
}

// Function to load AR experience
async function loadARExperience(experience) {
    if (lastExperience === experience) {
        console.log("This experience is already loaded.");
        return;
    }

    lastExperience = experience;

    await disposeARSession();

    try {
        // Initialize MindAR session
        mindARInstance = new MindARThree({
            container: document.querySelector("#mindar-container"),
            imageTargetSrc: `${experienceConfig.basePath}${experience.folder}/${experienceConfig.targetsFile}`
        });

        await mindARInstance.start();
        console.log("AR Experience started successfully:", experience.name);

        // Extract scene, camera, and renderer from MindAR instance
        const { renderer, scene, camera } = mindARInstance;
        renderer.setClearColor(0x000000, 0); // Transparent background

        // Set up lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        scene.add(ambientLight);

        const pointLight = new THREE.PointLight(0xffffff, 1, 100);
        pointLight.position.set(5, 5, 5);
        scene.add(pointLight);

        // Initialize EffectComposer for post-processing
        const composer = new EffectComposer(renderer);
        
        // Initialize shader passes
        chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
        glowPass = new ShaderPass(GlowShader);

        // Add render and shader passes
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(chromaticAberrationPass);
        composer.addPass(glowPass);

        // Set up target detection and video planes
        setupTargetDetection(experience.images, experience.folder);

        // Animation loop for rendering and shader updates
        const clock = new THREE.Clock();
        const animate = () => {
            const elapsedTime = clock.getElapsedTime();
            chromaticAberrationPass.uniforms['time'].value = elapsedTime; // Update time uniform for effects
            composer.render(); // Render using the composer
            requestAnimationFrame(animate); // Loop the animation
        };
        animate(); // Start animation

    } catch (error) {
        console.error("Failed to start AR session:", error);
    }
}

  // Custom Chromatic Aberration Shader
  const ChromaticAberrationShader = {
    uniforms: {
      tDiffuse: { value: null },
      amount: { value: 0.02 }, 
      glitchAmount: { value: 0 }, 
      time: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float amount;
      uniform float glitchAmount;
      uniform float time;
      varying vec2 vUv;

      float random(vec2 co) {
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 uv = vUv;
        float blockSize = 0.05; // Size of glitch blocks
        vec2 blockCoords = floor(uv / blockSize) * blockSize; 
        vec2 glitchMovement = vec2(sin(time * 5.0), cos(time * 3.0)) * blockSize * 0.5; 

        if (random(blockCoords + time) < glitchAmount) {
          uv += glitchMovement; // Displace blocks
        }

        vec2 redOffset = amount * vec2(sin(time * 2.0), cos(time * 2.0));
        vec2 greenOffset = amount * vec2(sin(time + 2.0), cos(time + 2.0));
        vec2 blueOffset = amount * vec2(sin(time + 4.0), cos(time + 4.0));

        vec4 cr = texture2D(tDiffuse, uv + redOffset);
        vec4 cg = texture2D(tDiffuse, uv);
        vec4 cb = texture2D(tDiffuse, uv - blueOffset);

        gl_FragColor = vec4(cr.r, cg.g, cb.b, cg.a);
      }
    `
  };

// Custom Glow Shader
const GlowShader = {
  uniforms: {
    tDiffuse: { value: null },
    glowIntensity: { value: 1.0 },
    glitchAmount: { value: 0 }, // Glitch intensity
    time: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float glowIntensity;
    uniform float glitchAmount;
    uniform float time;
    varying vec2 vUv;

    float random(vec2 co){
      return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Controlled glitch: Hide only small parts of the image
      if (random(vUv + time) < glitchAmount) {
        color.rgb *= 0.5; // Make glitch darker for better visibility
      }

      vec3 glow = color.rgb * glowIntensity;
      gl_FragColor = vec4(glow, color.a);
    }
  `
};

// Function to set up target detection and media handling
function setupTargetDetection(mediaData, experienceFolder) {
    mediaData.forEach((entry, index) => {
        const properties = entry.properties; 
        if (!properties) {
            console.error(`Properties are undefined for image entry at index ${index}`, entry);
            return; 
        }

        const anchor = mindARInstance.addAnchor(index);
        const videoSrc = `${experienceConfig.basePath}${experienceFolder}/${entry.video}`; 

        const { width, height, opacity } = properties;

        if (width === undefined || height === undefined || opacity === undefined) {
            console.error(`Missing properties for media entry at index ${index}:`, entry);
            return; 
        }

        const { plane, video } = createVideoPlane(videoSrc, width, height, opacity);
        anchor.group.add(plane); 

        anchor.onTargetFound = () => {
            video.play(); 
            applyEffects(properties); 
        };

        anchor.onTargetLost = () => {
            video.pause(); 
        };
    });
}

// Function to apply effects based on entry properties
function applyEffects(properties) {
    const rgbShiftIntensity = properties.rgbShiftIntensity || 0;
    const glowIntensity = properties.glowIntensity || 0;
    const glitchAmount = properties.glitchAmount || 0.1;

    chromaticAberrationPass.uniforms['amount'].value = rgbShiftIntensity;
    glowPass.uniforms['glowIntensity'].value = glowIntensity;
    chromaticAberrationPass.uniforms['glitchAmount'].value = glitchAmount;
}

// Function to create a video plane
function createVideoPlane(videoSrc, videoWidth, videoHeight, opacity) {
    const video = document.createElement('video');
    video.src = videoSrc;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.load();

    video.addEventListener('canplay', () => {
        video.play();
    });

    const texture = new THREE.VideoTexture(video);
    const aspectRatio = videoWidth / videoHeight;
    const planeWidth = 1; 
    const planeHeight = planeWidth / aspectRatio;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: opacity
    });

    return { plane: new THREE.Mesh(geometry, material), video };
}

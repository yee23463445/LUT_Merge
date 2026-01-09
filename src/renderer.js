import * as THREE from 'three';

export class LUTRenderer {
    constructor(container) {
        this.container = container;
        this.width = container.clientWidth;
        this.height = container.clientHeight;

        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true,
            alpha: true
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.width, this.height);
        this.container.appendChild(this.renderer.domElement);

        this.textureLoader = new THREE.TextureLoader();
        this.baseTexture = null;
        this.imageAspect = 1;

        // Custom shader for chained LUT rendering
        this.textureCache = new Map();
        this.dummyTexture = new THREE.Data3DTexture(new Float32Array(4), 1, 1, 1);
        this.initShader();

        window.addEventListener('resize', () => this.onResize());
    }

    initShader() {
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            precision highp float;
            precision highp sampler3D;

            varying vec2 vUv;
            uniform sampler2D tDiffuse;
            
            uniform sampler3D lutTextures[5];
            uniform float lutIntensities[5];
            uniform int lutCount;
            uniform float showOriginal;

            void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                vec3 originalRgb = color.rgb;
                vec3 rgb = originalRgb;

                // Unrolled loop for WebGL compatibility
                if (lutCount > 0) {
                    rgb = mix(rgb, texture(lutTextures[0], rgb).rgb, lutIntensities[0]);
                }
                if (lutCount > 1) {
                    rgb = mix(rgb, texture(lutTextures[1], rgb).rgb, lutIntensities[1]);
                }
                if (lutCount > 2) {
                    rgb = mix(rgb, texture(lutTextures[2], rgb).rgb, lutIntensities[2]);
                }
                if (lutCount > 3) {
                    rgb = mix(rgb, texture(lutTextures[3], rgb).rgb, lutIntensities[3]);
                }
                if (lutCount > 4) {
                    rgb = mix(rgb, texture(lutTextures[4], rgb).rgb, lutIntensities[4]);
                }

                rgb = mix(rgb, originalRgb, showOriginal);

                gl_FragColor = vec4(rgb, color.a);
            }
        `;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                lutTextures: { value: Array(5).fill(null) },
                lutIntensities: { value: Array(5).fill(0) },
                lutCount: { value: 0 },
                showOriginal: { value: 0.0 }
            },
            vertexShader,
            fragmentShader
        });

        const geometry = new THREE.PlaneGeometry(2, 2);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.scene.add(this.mesh);
    }

    setImage(imageSrc) {
        return new Promise((resolve) => {
            this.textureLoader.load(imageSrc, (texture) => {
                this.baseTexture = texture;
                this.baseTexture.minFilter = THREE.LinearFilter;
                this.baseTexture.magFilter = THREE.LinearFilter;
                this.imageAspect = texture.image.width / texture.image.height;
                this.material.uniforms.tDiffuse.value = texture;
                this.fitImageToContainer();
                this.render();
                resolve();
            });
        });
    }

    fitImageToContainer() {
        const containerAspect = this.container.clientWidth / this.container.clientHeight;
        if (this.imageAspect > containerAspect) {
            this.mesh.scale.set(1, 1 / this.imageAspect * containerAspect, 1);
        } else {
            this.mesh.scale.set(this.imageAspect / containerAspect, 1, 1);
        }
    }

    updateLUTChain(lutDatas) {
        const textures = [];
        const intensities = [];

        lutDatas.slice(0, 5).forEach(lut => {
            let texture = this.textureCache.get(lut.id);
            if (!texture) {
                texture = new THREE.Data3DTexture(lut.data, lut.size, lut.size, lut.size);
                texture.format = THREE.RGBAFormat;
                texture.type = THREE.FloatType;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.unpackAlignment = 1;
                texture.needsUpdate = true;
                this.textureCache.set(lut.id, texture);
            }

            textures.push(texture);
            intensities.push(lut.intensity);
        });

        while (textures.length < 5) {
            textures.push(this.dummyTexture);
            intensities.push(0);
        }

        this.material.uniforms.lutTextures.value = textures;
        this.material.uniforms.lutIntensities.value = intensities;
        this.material.uniforms.lutCount.value = Math.min(lutDatas.length, 5);
        this.render();
    }

    disposeLUT(lutId) {
        const texture = this.textureCache.get(lutId);
        if (texture) {
            texture.dispose();
            this.textureCache.delete(lutId);
        }
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }

    setCompare(showOriginal) {
        this.material.uniforms.showOriginal.value = showOriginal ? 1.0 : 0.0;
        this.render();
    }

    onResize() {
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        this.renderer.setSize(this.width, this.height);
        this.fitImageToContainer();
        this.render();
    }

    exportImage() {
        return this.renderer.domElement.toDataURL('image/png');
    }

    generateThumbnail(lutData, intensity = 1.0) {
        if (!this.baseTexture) return null;

        if (!this.offscreenRenderer) {
            this.offscreenCanvas = document.createElement('canvas');
            this.offscreenCanvas.width = 480;
            this.offscreenCanvas.height = 270;
            this.offscreenRenderer = new THREE.WebGLRenderer({
                canvas: this.offscreenCanvas,
                antialias: true,
                alpha: true,
                preserveDrawingBuffer: true
            });
            this.offscreenScene = new THREE.Scene();
            this.offscreenMaterial = this.material.clone();
            const geometry = new THREE.PlaneGeometry(2, 2);
            this.offscreenMesh = new THREE.Mesh(geometry, this.offscreenMaterial);
            this.offscreenScene.add(this.offscreenMesh);
        }

        // Reuse cached lookup textures if possible, but for thumb we create a temporary one
        const texture = new THREE.Data3DTexture(lutData.data, lutData.size, lutData.size, lutData.size);
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.FloatType;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.unpackAlignment = 1;
        texture.needsUpdate = true;

        const textures = [texture, this.dummyTexture, this.dummyTexture, this.dummyTexture, this.dummyTexture];

        this.offscreenMaterial.uniforms.tDiffuse.value = this.baseTexture;
        this.offscreenMaterial.uniforms.lutTextures.value = textures;
        this.offscreenMaterial.uniforms.lutIntensities.value = [intensity, 0, 0, 0, 0];
        this.offscreenMaterial.uniforms.lutCount.value = 1;
        this.offscreenMaterial.uniforms.showOriginal.value = 0.0; // Ensure processed view

        // Custom aspect ratio logic for "cover" effect
        const canvasAspect = 480 / 270;
        if (this.imageAspect > canvasAspect) {
            this.offscreenMesh.scale.set(this.imageAspect / canvasAspect, 1, 1);
        } else {
            this.offscreenMesh.scale.set(1, canvasAspect / this.imageAspect, 1);
        }

        this.offscreenRenderer.render(this.offscreenScene, this.camera);
        const url = this.offscreenCanvas.toDataURL('image/jpeg', 0.95);

        texture.dispose();
        return url;
    }
}

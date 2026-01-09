import './style.css';
import { v4 as uuidv4 } from 'uuid';
import { parseCubeLUT, generateCubeLUT } from './lut-parser';
import { LUTRenderer } from './renderer';

class App {
    constructor() {
        this.state = {
            photos: [],
            currentPhotoIndex: -1,
            lutLibrary: [],
            activeChain: [],
            zoom: 1.0,
            comparing: false
        };

        this.init();
    }

    async init() {
        this.container = document.getElementById('canvas-container');
        this.renderer = new LUTRenderer(this.container);

        this.setupEventListeners();
        this.renderLibrary();
        this.renderPhotoStream();
    }

    setupEventListeners() {
        document.getElementById('add-photo-btn').onclick = () => document.getElementById('photo-input').click();
        document.getElementById('photo-input').onchange = (e) => this.handlePhotoUpload(e);

        document.getElementById('import-lut-btn').onclick = () => document.getElementById('lut-input').click();
        document.getElementById('lut-input').onchange = (e) => this.handleLUTUpload(e);

        document.getElementById('export-photo-btn').onclick = () => this.exportPhoto();
        document.getElementById('export-lut-btn').onclick = () => this.exportMergedLUT();

        const dropZone = document.getElementById('chain-drop-zone');
        dropZone.ondragover = (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        };
        dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const lutId = e.dataTransfer.getData('lut-id');
            if (lutId) this.addToChain(lutId);
        };

        document.getElementById('zoom-in').onclick = () => this.adjustZoom(0.1);
        document.getElementById('zoom-out').onclick = () => this.adjustZoom(-0.1);
        document.getElementById('zoom-reset').onclick = () => this.adjustZoom(0, true);

        const compareBtn = document.getElementById('compare-btn');
        compareBtn.onclick = () => this.toggleComparison();

        // Keyboard support: Toggle with '\' or hold 'Alt' (optional, let's do '\' for now)
        window.addEventListener('keydown', (e) => {
            if (e.key === '\\') {
                this.toggleComparison(true);
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === '\\') {
                this.toggleComparison(false);
            }
        });

        // Photo Drag and Drop
        const photoZones = [
            document.getElementById('canvas-container'),
            document.getElementById('photo-stream')
        ];

        photoZones.forEach(zone => {
            if (!zone) return;
            zone.ondragover = (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            };
            zone.ondragleave = () => zone.classList.remove('drag-over');
            zone.ondrop = (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                if (files.length > 0) this.processPhotos(files);
            };
        });

        // Context Menu Hide
        window.addEventListener('click', () => this.hideContextMenu());
        window.addEventListener('scroll', () => this.hideContextMenu(), true);
    }

    async handlePhotoUpload(event) {
        const files = Array.from(event.target.files);
        await this.processPhotos(files);
    }

    async processPhotos(files) {
        for (const file of files) {
            const url = URL.createObjectURL(file);
            this.state.photos.push({ id: uuidv4(), url, name: file.name });
        }

        if (this.state.photos.length > 0) {
            // Always select the last added photo
            await this.selectPhoto(this.state.photos.length - 1);
        }
    }

    async selectPhoto(index) {
        this.state.currentPhotoIndex = index;
        const photo = this.state.photos[index];
        await this.renderer.setImage(photo.url);
        this.updateRendererChain();
        this.renderPhotoStream();
        this.renderLibrary();
        this.renderChain();
    }

    removePhoto(id) {
        const index = this.state.photos.findIndex(p => p.id === id);
        if (index === -1) return;

        URL.revokeObjectURL(this.state.photos[index].url);
        this.state.photos.splice(index, 1);

        if (this.state.currentPhotoIndex === index) {
            this.state.currentPhotoIndex = this.state.photos.length > 0 ? 0 : -1;
            if (this.state.currentPhotoIndex !== -1) {
                this.selectPhoto(0);
            }
        } else if (this.state.currentPhotoIndex > index) {
            this.state.currentPhotoIndex--;
        }

        this.renderPhotoStream();
        this.renderLibrary();
        this.renderChain();
    }

    async handleLUTUpload(event) {
        const files = Array.from(event.target.files);
        for (const file of files) {
            const content = await file.text();
            try {
                const lutData = parseCubeLUT(content);
                this.state.lutLibrary.push({
                    id: uuidv4(),
                    name: file.name,
                    data: lutData
                });
            } catch (err) {
                console.error("Failed to parse LUT:", file.name, err);
            }
        }
        this.renderLibrary();
    }

    removeLUTFromLibrary(id) {
        this.renderer.disposeLUT(id);
        this.state.lutLibrary = this.state.lutLibrary.filter(lut => lut.id !== id);
        this.state.activeChain = this.state.activeChain.filter(item => item.lutId !== id);
        this.renderLibrary();
        this.renderChain();
        this.updateRendererChain();
    }

    addToChain(lutId) {
        if (this.state.activeChain.length >= 5) {
            alert("Maximum 5 LUTs in chain");
            return;
        }
        this.state.activeChain.push({
            id: uuidv4(),
            lutId: lutId,
            intensity: 1.0
        });
        this.renderChain();
        this.updateRendererChain();
    }

    removeFromChain(chainId) {
        this.state.activeChain = this.state.activeChain.filter(item => item.id !== chainId);
        this.renderChain();
        this.updateRendererChain();
    }

    updateIntensity(chainId, intensity) {
        const item = this.state.activeChain.find(i => i.id === chainId);
        if (item) {
            item.intensity = Math.max(0, Math.min(1, intensity));

            // Update DOM directly to avoid full re-render
            const itemEl = document.querySelector(`.lut-chain-item[data-id="${chainId}"]`);
            if (itemEl) {
                const barFill = itemEl.querySelector('.intensity-bar-fill');
                const dragHandle = itemEl.querySelector('.intensity-drag-handle');
                const label = itemEl.querySelector('.intensity-label');
                const imgContainer = itemEl.querySelector('.lut-preview-img');

                const percent = `${item.intensity * 100}%`;
                if (barFill) barFill.style.width = percent;
                if (dragHandle) dragHandle.style.left = percent;
                if (label) label.textContent = `${Math.round(item.intensity * 100)}%`;
            }

            this.updateRendererChain();
        }
    }

    updateRendererChain() {
        const chainData = this.state.activeChain.map(item => {
            const lut = this.state.lutLibrary.find(l => l.id === item.lutId);
            return {
                id: lut.id,
                data: lut.data.data,
                size: lut.data.size,
                intensity: item.intensity
            };
        });
        this.renderer.updateLUTChain(chainData);
    }

    renderLibrary() {
        const libraryEl = document.getElementById('lut-library');
        libraryEl.innerHTML = '';

        this.state.lutLibrary.forEach(lut => {
            const card = document.createElement('div');
            card.className = 'lut-card';
            card.draggable = true;
            card.ondragstart = (e) => e.dataTransfer.setData('lut-id', lut.id);
            card.oncontextmenu = (e) => {
                e.preventDefault();
                this.showContextMenu(e.pageX, e.pageY, () => this.removeLUTFromLibrary(lut.id));
            };

            const preview = document.createElement('div');
            preview.className = 'lut-preview-img';
            preview.style.backgroundColor = '#333';

            if (this.state.currentPhotoIndex !== -1) {
                const thumbUrl = this.renderer.generateThumbnail(lut.data);
                if (thumbUrl) {
                    preview.innerHTML = `<img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;"/>`;
                }
            }

            const info = document.createElement('div');
            info.className = 'lut-info';
            info.innerHTML = `<span class="lut-name" title="${lut.name}">${lut.name}</span>`;

            card.appendChild(preview);
            card.appendChild(info);
            libraryEl.appendChild(card);
        });
    }

    renderChain() {
        const chainEl = document.getElementById('lut-chain');
        const dropZone = document.getElementById('chain-drop-zone');

        const existingItems = chainEl.querySelectorAll('.lut-chain-item, .chain-arrow');
        existingItems.forEach(el => el.remove());

        this.state.activeChain.forEach((item, index) => {
            const lut = this.state.lutLibrary.find(l => l.id === item.lutId);
            if (!lut) return;

            const chainItem = document.createElement('div');
            chainItem.className = 'lut-chain-item';
            chainItem.dataset.id = item.id;
            const card = document.createElement('div');
            card.className = 'lut-card';

            const barContainer = document.createElement('div');
            barContainer.className = 'intensity-bar-container';

            const barFill = document.createElement('div');
            barFill.className = 'intensity-bar-fill';
            const initialPercent = `${item.intensity * 100}%`;
            barFill.style.width = initialPercent;

            const dragHandle = document.createElement('div');
            dragHandle.className = 'intensity-drag-handle';
            dragHandle.style.left = initialPercent;

            barContainer.appendChild(barFill);
            barContainer.appendChild(dragHandle);

            const label = document.createElement('div');
            label.className = 'intensity-label';
            label.textContent = `${Math.round(item.intensity * 100)}%`;

            card.onmousedown = (e) => {
                if (e.button !== 0) return; // Only left click
                const rect = card.getBoundingClientRect();
                // Match CSS: left: 20px, right: 20px
                const barLeft = rect.left + 20;
                const barWidth = rect.width - 40;

                const update = (moveEvent) => {
                    const x = moveEvent.clientX - barLeft;
                    const newIntensity = Math.max(0, Math.min(1, x / barWidth));
                    this.updateIntensity(item.id, newIntensity);
                };


                update(e);

                window.addEventListener('mousemove', update);
                window.addEventListener('mouseup', () => {
                    window.removeEventListener('mousemove', update);
                }, { once: true });

                e.preventDefault(); // Prevent text selection/drag ghosting
            };

            const img = document.createElement('div');
            img.className = 'lut-preview-img';
            img.style.backgroundColor = '#222';
            if (this.state.currentPhotoIndex !== -1) {
                // Always show 100% intensity for the merger preview as requested
                const thumbUrl = this.renderer.generateThumbnail(lut.data, 1.0);
                if (thumbUrl) {
                    img.innerHTML = `<img src="${thumbUrl}" style="width:100%; height:100%; object-fit:cover;"/>`;
                }
            }

            const info = document.createElement('div');
            info.className = 'lut-info';
            info.innerHTML = `<span class="lut-name">${lut.name}</span>`;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'lut-remove-btn';
            removeBtn.innerHTML = '×';
            removeBtn.onmousedown = (e) => e.stopPropagation();
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                this.removeFromChain(item.id);
            };

            card.appendChild(img);
            card.appendChild(barContainer);
            card.appendChild(label);
            card.appendChild(info);
            card.appendChild(removeBtn);
            chainItem.appendChild(card);

            chainEl.insertBefore(chainItem, dropZone);

            const arrow = document.createElement('div');
            arrow.className = 'chain-arrow';
            arrow.innerHTML = '↓';
            chainEl.insertBefore(arrow, dropZone);
        });
    }

    renderPhotoStream() {
        const streamEl = document.getElementById('photo-stream');
        streamEl.innerHTML = '';

        this.state.photos.forEach((photo, index) => {
            const thumb = document.createElement('div');
            thumb.className = `photo-thumb ${index === this.state.currentPhotoIndex ? 'active' : ''}`;
            thumb.innerHTML = `<img src="${photo.url}" alt="${photo.name}">`;
            thumb.onclick = () => this.selectPhoto(index);
            thumb.oncontextmenu = (e) => {
                e.preventDefault();
                this.showContextMenu(e.pageX, e.pageY, () => this.removePhoto(photo.id));
            };
            streamEl.appendChild(thumb);
        });
    }

    adjustZoom(delta, reset = false) {
        if (reset) this.state.zoom = 1.0;
        else this.state.zoom = Math.max(0.1, Math.min(5.0, this.state.zoom + delta));

        const canvas = this.container.querySelector('canvas');
        if (canvas) {
            canvas.style.transform = `scale(${this.state.zoom})`;
        }
    }

    toggleComparison(force) {
        if (typeof force === 'boolean') {
            this.state.comparing = force;
        } else {
            this.state.comparing = !this.state.comparing;
        }

        const btn = document.getElementById('compare-btn');
        if (this.state.comparing) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        this.renderer.setCompare(this.state.comparing);
    }

    showContextMenu(x, y, action) {
        const menu = document.getElementById('context-menu');
        const removeBtn = document.getElementById('context-menu-remove');

        menu.style.display = 'block';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        removeBtn.onclick = () => {
            action();
            this.hideContextMenu();
        };

        // Constrain to window
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${y - rect.height}px`;
        }
    }

    hideContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
    }

    exportPhoto() {
        if (this.state.currentPhotoIndex === -1) return;
        const dataUrl = this.renderer.exportImage();
        const link = document.createElement('a');
        link.download = `edited_${this.state.photos[this.state.currentPhotoIndex].name}`;
        link.href = dataUrl;
        link.click();
    }

    exportMergedLUT() {
        if (this.state.activeChain.length === 0) return;

        const size = 32;
        const mergedData = new Float32Array(size * size * size * 4);

        for (let r = 0; r < size; r++) {
            for (let g = 0; g < size; g++) {
                for (let b = 0; b < size; b++) {
                    let currR = r / (size - 1);
                    let currG = g / (size - 1);
                    let currB = b / (size - 1);

                    for (const item of this.state.activeChain) {
                        const lut = this.state.lutLibrary.find(l => l.id === item.lutId);
                        const intensity = item.intensity;
                        const lutResult = this.sampleLUT(lut.data, currR, currG, currB);
                        currR = currR * (1 - intensity) + lutResult[0] * intensity;
                        currG = currG * (1 - intensity) + lutResult[1] * intensity;
                        currB = currB * (1 - intensity) + lutResult[2] * intensity;
                    }

                    const idx = (r + g * size + b * size * size) * 4;
                    mergedData[idx] = currR;
                    mergedData[idx + 1] = currG;
                    mergedData[idx + 2] = currB;
                    mergedData[idx + 3] = 1.0;
                }
            }
        }

        const cubeContent = generateCubeLUT(size, mergedData);
        const blob = new Blob([cubeContent], { type: 'text/plain' });
        const link = document.createElement('a');
        link.download = 'merged_lut.cube';
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    sampleLUT(lutData, r, g, b) {
        const size = lutData.size;
        const data = lutData.data;

        const fr = Math.max(0, Math.min(size - 1.0001, r * (size - 1)));
        const fg = Math.max(0, Math.min(size - 1.0001, g * (size - 1)));
        const fb = Math.max(0, Math.min(size - 1.0001, b * (size - 1)));

        const r0 = Math.floor(fr);
        const r1 = r0 + 1;
        const g0 = Math.floor(fg);
        const g1 = g0 + 1;
        const b0 = Math.floor(fb);
        const b1 = b0 + 1;

        const dr = fr - r0;
        const dg = fg - g0;
        const db = fb - b0;

        const getIdx = (ir, ig, ib) => (ir + ig * size + ib * size * size) * 4;

        const c000 = [data[getIdx(r0, g0, b0)], data[getIdx(r0, g0, b0) + 1], data[getIdx(r0, g0, b0) + 2]];
        const c100 = [data[getIdx(r1, g0, b0)], data[getIdx(r1, g0, b0) + 1], data[getIdx(r1, g0, b0) + 2]];
        const c010 = [data[getIdx(r0, g1, b0)], data[getIdx(r0, g1, b0) + 1], data[getIdx(r0, g1, b0) + 2]];
        const c110 = [data[getIdx(r1, g1, b0)], data[getIdx(r1, g1, b0) + 1], data[getIdx(r1, g1, b0) + 2]];
        const c001 = [data[getIdx(r0, g0, b1)], data[getIdx(r0, g0, b1) + 1], data[getIdx(r0, g0, b1) + 2]];
        const c101 = [data[getIdx(r1, g0, b1)], data[getIdx(r1, g0, b1) + 1], data[getIdx(r1, g0, b1) + 2]];
        const c011 = [data[getIdx(r0, g1, b1)], data[getIdx(r0, g1, b1) + 1], data[getIdx(r0, g1, b1) + 2]];
        const c111 = [data[getIdx(r1, g1, b1)], data[getIdx(r1, g1, b1) + 1], data[getIdx(r1, g1, b1) + 2]];

        const x0 = c000.map((v, i) => v * (1 - dr) + c100[i] * dr);
        const x1 = c010.map((v, i) => v * (1 - dr) + c110[i] * dr);
        const x2 = c001.map((v, i) => v * (1 - dr) + c101[i] * dr);
        const x3 = c011.map((v, i) => v * (1 - dr) + c111[i] * dr);

        const y0 = x0.map((v, i) => v * (1 - dg) + x1[i] * dg);
        const y1 = x2.map((v, i) => v * (1 - dg) + x3[i] * dg);

        return y0.map((v, i) => v * (1 - db) + y1[i] * db);
    }
}

new App();

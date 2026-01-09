/**
 * CUBE LUT Parser
 * Based on the Adobe CUBE specification
 */

export function parseCubeLUT(fileContent) {
    const lines = fileContent.split('\n');
    let title = '';
    let size = 0;
    let min = [0, 0, 0];
    let max = [1, 1, 1];
    const data = [];

    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;

        const parts = line.split(/\s+/);
        const command = parts[0].toUpperCase();

        if (command === 'TITLE') {
            title = parts.slice(1).join(' ').replace(/"/g, '');
        } else if (command === 'LUT_3D_SIZE') {
            size = parseInt(parts[1], 10);
        } else if (command === 'DOMAIN_MIN') {
            min = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
        } else if (command === 'DOMAIN_MAX') {
            max = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
        } else if (!isNaN(parseFloat(parts[0]))) {
            data.push(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]), 1.0); // RGBA
        }
    }

    if (size === 0) throw new Error('Invalid LUT: LUT_3D_SIZE not found');
    if (data.length !== size * size * size * 4) {
         // Some LUTs might not have alpha, let's adjust if needed
         if (data.length === size * size * size * 3) {
             const rgbaData = new Float32Array(size * size * size * 4);
             for(let i=0; i<size*size*size; i++) {
                 rgbaData[i*4] = data[i*3];
                 rgbaData[i*4+1] = data[i*3+1];
                 rgbaData[i*4+2] = data[i*3+2];
                 rgbaData[i*4+3] = 1.0;
             }
             return { title, size, min, max, data: rgbaData };
         }
         throw new Error(`Data size mismatch: expected ${size*size*size*3} or ${size*size*size*4}, got ${data.length}`);
    }

    return { title, size, min, max, data: new Float32Array(data) };
}

export function generateCubeLUT(size, data, title = 'Merged LUT') {
    let cube = `# Created by LUT Merge\n`;
    cube += `TITLE "${title}"\n`;
    cube += `LUT_3D_SIZE ${size}\n`;
    cube += `DOMAIN_MIN 0.0 0.0 0.0\n`;
    cube += `DOMAIN_MAX 1.0 1.0 1.0\n\n`;

    for (let i = 0; i < data.length; i += 4) {
        cube += `${data[i].toFixed(6)} ${data[i+1].toFixed(6)} ${data[i+2].toFixed(6)}\n`;
    }

    return cube;
}

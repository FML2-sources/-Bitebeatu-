if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
};

let audioCtx = null;
let workletNode = null;
let isPlaying = false;
let globalT = 0;
let currentSampleRate = 8000;
let currentMode = "bytebeat";
let currentSyntax = "infix";
let currentValueFormat = "unsigned";
let currentError = null;
let currentMouseX = 0;
let currentMouseY = 0;
let currentTiltX = 0;
let currentTiltY = 0;
let currentCompass = 0;
let currentWidth = window.innerWidth;
let currentHeight = window.innerHeight;

const VIS_SIZE = 5513;
let visL = new Array(VIS_SIZE).fill(0);
let visR = new Array(VIS_SIZE).fill(0);
let visIdx = 0;

let defaultCode = `t& (t>>8&255)`;
let fps = 30;
const fpsInput = document.getElementById('fpsControl');
fpsInput.oninput = (e) => {
    fps = Math.max(0, Math.min(1000, parseInt(e.target.value) || 30));
};
let lastDraw = 0;
let drawRequest = null;

function updateErrorButton(errorMsg) {
    const btn = document.getElementById('errorBtn');
    if (!btn) return;
    
    if (errorMsg) {
        currentError = errorMsg;
        btn.innerHTML = errorMsg;
        btn.style.color = '#ff6666';
        btn.style.borderColor = '#ff0000';
        btn.style.background = '#330000';
    } else {
        currentError = null;
        btn.innerHTML = '。';
        btn.style.color = '#FEDCBA';
        btn.style.borderColor = '#333';
        btn.style.background = 'rgba(0,0,0,0.85)';
    }
}

function copyErrorToClipboard() {
    if (!currentError) return;
    
    const btn = document.getElementById('errorBtn');
    
    navigator.clipboard.writeText(currentError);
    
    btn.innerHTML = 'copied!';
    btn.style.color = '#00ff00';
    
    setTimeout(() => {
        if (currentError) {
            btn.innerHTML = currentError;
            btn.style.color = '#ff6666';
        } else {
            btn.innerHTML = '。';
            btn.style.color = '#FEDCBA';
        }
    }, 1000);
}

function saveStateToURL() {
    let code = window.editor ? window.editor.getValue() : defaultCode;
    
    const exportSamples = parseInt(document.getElementById('exportSamplesInput').value) || 40000;
    const exportStereo = document.getElementById('stereoCheckbox').checked;
    
    let state = {
        c: code,
        m: currentMode,
        s: currentSyntax,
        r: currentSampleRate,
        e: {
            n: exportSamples, 
            st: exportStereo
        }
    };
    
    let json = JSON.stringify(state);
    let compressed = LZMA.compress(json, 1);
    let base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(compressed)));
    window.location.hash = base64;
}

function loadStateFromURL() {
    if (!window.location.hash || window.location.hash.length <= 1) return false;
    
    try {
        let base64 = window.location.hash.substring(1);
        let binary = atob(base64);
        let bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        
        let json = LZMA.decompress(bytes);
        let params = JSON.parse(json);
        
        if (params.c && window.editor) {
            window.editor.setValue(params.c);
        }
        
        if (params.m) {
            currentMode = params.m;
            document.getElementById('modeSelect').value = params.m;
        }
        
        if (params.s) {
            currentSyntax = params.s;
            document.getElementById('syntaxSelect').value = params.s;
        }
        
        if (params.r && !isNaN(params.r)) {
            currentSampleRate = parseInt(params.r);
            document.getElementById('sampleRateInput').value = currentSampleRate;
        }
        
        if (params.e) {
            if (params.e.n && !isNaN(params.e.n)) {
                document.getElementById('exportSamplesInput').value = params.e.n;
            }
            if (params.e.st !== undefined) {
                document.getElementById('stereoCheckbox').checked = params.e.st;
            }
        }
        
        return true;
    } catch(e) {
        console.warn("load error", e);
        return false;
    }
}

function formatChannelValue(rawValue, mode, format) {
    if (format === "float") {
        return rawValue.toFixed(4);
    }
    
    if (format === "unsigned") {
        return Math.floor((rawValue + 1) / 2 * 255);
    }
    
    if (format === "signed") {
        return Math.floor(rawValue * 127);
    }
    
    return rawValue.toFixed(4);
}

function sendSensorData() {
    if (workletNode && workletNode.port) {
        workletNode.port.postMessage({
            type: 'sensors',
            data: {
                mouseX: currentMouseX,
                mouseY: currentMouseY,
                tiltX: currentTiltX,
                tiltY: currentTiltY,
                compass: currentCompass,
                width: currentWidth,
                height: currentHeight
            }
        });
    }
}

setInterval(sendSensorData, 50);

function pushVis(l, r) {
    visL[visIdx] = l;
    visR[visIdx] = r;
    visIdx = (visIdx + 1) % VIS_SIZE;
    
    let formattedL = formatChannelValue(l, currentMode, currentValueFormat);
    let formattedR = formatChannelValue(r, currentMode, currentValueFormat);

    document.getElementById('ch1Val').innerHTML = `L: ${formattedL}`;
    document.getElementById('ch2Val').innerHTML = `R: ${formattedR}`;
}

function updateTDisplay() {
    document.getElementById('resetBtn').innerHTML = `t = ${globalT}`;
}

function isMono() {
    let diff = 0;
    let count = Math.min(150, VIS_SIZE);
    for (let i = 0; i < count; i++) {
        let idx = (visIdx - 1 - i + VIS_SIZE) % VIS_SIZE;
        diff += Math.abs(visL[idx] - visR[idx]);
    }
    return diff / count < 0.008;
}

async function initAudio() {
    let newSR = parseInt(document.getElementById('sampleRateInput').value, 10);
    if (isNaN(newSR)) newSR = 8000;
    currentSampleRate = newSR;
    
    if (audioCtx) {
        if (workletNode) workletNode.disconnect();
        await audioCtx.close();
    }
    
    audioCtx = new AudioContext();
    
    await audioCtx.audioWorklet.addModule('processor.js');
    
    workletNode = new AudioWorkletNode(audioCtx, 'bytebeat-processor', {
        outputChannelCount: [2]
    });
    workletNode.connect(audioCtx.destination);
    
    workletNode.port.onmessage = (e) => {
        if (e.data.type === 'vis') {
            for (let i = 0; i < e.data.l.length; i++) {
                pushVis(e.data.l[i], e.data.r[i]);
            }
            globalT = e.data.t;
            updateTDisplay();
        } else if (e.data.type === 'error') { 
            updateErrorButton(e.data.message);
        } else if (e.data.type === 'wavData') {
	console.log("uhm")
        saveWav(
            e.data.samples, 
            e.data.sampleRate, 
            e.data.bitsPerSample, 
            e.data.isSigned
        );
    }
    };
    
    workletNode.port.postMessage({
        type: 'init',
        mode: currentMode,
        genRate: currentSampleRate,
        syntax: currentSyntax,
        currentT: globalT
    });
}

async function startPlayback() {
    if (!audioCtx) {
        await initAudio();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    isPlaying = true;
    document.getElementById('playPauseBtn').innerHTML = '⏹';
}

function stopPlayback() {
    isPlaying = false;
    if (audioCtx) {
        audioCtx.suspend();
    }
    document.getElementById('playPauseBtn').innerHTML = '▶';
}

function resetT() {
    globalT = 0;
    updateTDisplay();
    if (workletNode && workletNode.port) {
        workletNode.port.postMessage({ type: 'reset' });
    }
}

async function updateCode() {
    updateErrorButton(null);
    if (workletNode && workletNode.port) {
        let rawCode = (window.editor ? window.editor.getValue() : defaultCode).replace(/;\s*$/, '');
        workletNode.port.postMessage({
            type: 'update',
            func: rawCode,
            mode: currentMode,
            genRate: currentSampleRate,
            syntax: currentSyntax,
            currentT: globalT
        });
    }
}

let canvas = document.getElementById('waveCanvas');
let ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function drawWave() {
    const now = performance.now();
    const interval = 1000 / fps;
    if (now - lastDraw >= interval) {
        lastDraw = now;
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        if (w === 0 || h === 0) return;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
        
        const step = Math.max(1, Math.floor(VIS_SIZE / (w * 1.2)));
        const centerY = h / 2;
        const getY = (val) => centerY - val * (h / 2);
        
        const mono = isMono();
        
        if (mono) {
            let hue = (Date.now() * 0.003) % 360;
            ctx.beginPath();
            ctx.strokeStyle = `hsl(${hue}, 100%, 55%)`;
            ctx.lineWidth = 2.5;
            let first = true;
            for (let x = 0; x < w; x += 2) {
                let idx = (visIdx - 1 - Math.floor(x * step) + VIS_SIZE * 2) % VIS_SIZE;
                let val = visL[idx] || 0;
                let y = getY(val);
                if (first) { ctx.moveTo(x, y); first = false; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        } else {
            ctx.beginPath();
            let t = Math.abs((Date.now() * 0.00005) % 2 - 1);
            let rL = Math.floor(0 + (255 - 0) * t);
            let gL = Math.floor(255 + (0 - 255) * t);
            let bL = Math.floor(0 + (255 - 0) * t);
            ctx.strokeStyle = `rgb(${rL}, ${gL}, ${bL})`;
            ctx.lineWidth = 1.8;
            let first = true;
            for (let x = 0; x < w; x += 2) {
                let idx = (visIdx - 1 - Math.floor(x * step) + VIS_SIZE * 2) % VIS_SIZE;
                let val = visL[idx] || 0;
                let y = getY(val);
                if (first) { ctx.moveTo(x, y); first = false; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            
            ctx.beginPath();
            let t2 = Math.abs((Date.now() * 0.00005) % 2 - 1);
            let rR = Math.floor(171 + (250 - 171) * t2);
            let gR = Math.floor(205 + (170 - 205) * t2);
            let bR = Math.floor(239 + (175 - 239) * t2);
            ctx.strokeStyle = `rgb(${rR}, ${gR}, ${bR})`;
            ctx.lineWidth = 1.8;
            first = true;
            for (let x = 0; x < w; x += 2) {
                let idx = (visIdx - 1 - Math.floor(x * step) + VIS_SIZE * 2) % VIS_SIZE;
                let val = visR[idx] || 0;
                let y = getY(val);
                if (first) { ctx.moveTo(x, y); first = false; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }
    drawRequest = requestAnimationFrame(drawWave);
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function saveWav(samples, sampleRate, bitsPerSample, isSigned) {
    console.log("combine")
    const numChannels = 2;
    const numSamples = samples.length;
    const dataSize = numSamples * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        let val = Math.max(-1, Math.min(1, samples[i]));
        
        if (bitsPerSample === 16) {
            const int16 = val < 0 ? val * 0x8000 : val * 0x7FFF;
            view.setInt16(offset, Math.round(int16), true);
            offset += 2;
        } else {
            let byte;
            if (isSigned) {
                byte = Math.round(val * 127);
                byte = Math.max(-128, Math.min(127, byte));
                view.setInt8(offset, byte);
            } else {
                byte = Math.round((val + 1) / 2 * 255);
                byte = Math.max(0, Math.min(255, byte));
                view.setUint8(offset, byte);
            }
            offset += 1;
        }
    }
    
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bytebeat_${bitsPerSample}bit_${Date.now().toString().slice(-5)}.wav`;
    a.click();
    URL.revokeObjectURL(url);
}

window.onload = async () => {
    resizeCanvas();
    
    window.addEventListener('resize', resizeCanvas);
	
	window.addEventListener('mousemove', (e) => {
		currentMouseX = e.clientX;
		currentMouseY = e.clientY;
	});
	
	window.addEventListener('deviceorientation', (e) => {
		currentTiltX = e.beta || 0;
		currentTiltY = e.gamma || 0;
		currentCompass = e.alpha || 0;
	});
	
	window.addEventListener('resize', () => {
		currentWidth = window.innerWidth;
		currentHeight = window.innerHeight;
	});
    
    const editorElem = document.getElementById('codeEditor');
    window.editor = CodeMirror.fromTextArea(editorElem, {
        lineNumbers: true,
        mode: "javascript",
        theme: "monokai",
        lineWrapping: true,
		indentWithTabs: false,
		smartIndent: false
    });
    
    let loaded = loadStateFromURL();
    if (!loaded && (!window.editor.getValue() || window.editor.getValue() === '')) {
        window.editor.setValue(defaultCode);
    }
    
    document.getElementById('playPauseBtn').onclick = () => { 
        if(isPlaying) stopPlayback(); 
        else startPlayback(); 
    };
    document.getElementById('errorBtn').onclick = () => {
        if (currentError) {
            copyErrorToClipboard();
        }
    };
    document.getElementById('resetBtn').onclick = () => resetT();
    document.getElementById('toggleCodeBtn').onclick = () => {
        document.getElementById('codeOverlay').classList.toggle('hidden');
        if(!document.getElementById('codeOverlay').classList.contains('hidden')) window.editor.refresh();
    };
    document.getElementById('modeSelect').onchange = (e) => { 
        currentMode = e.target.value;
    };
    document.getElementById('syntaxSelect').onchange = () => {
        currentSyntax = document.getElementById('syntaxSelect').value;
    };
	document.getElementById('compileBtn').onclick = () => {
		updateCode();
	};
    document.getElementById('valueFormatSelect').onchange = (e) => {
        currentValueFormat = e.target.value;
    
        let lastIdx = (visIdx - 1 + VIS_SIZE) % VIS_SIZE;
        let lastL = visL[lastIdx];
        let lastR = visR[lastIdx];
        
        let formattedL = formatChannelValue(lastL, currentMode, currentValueFormat);
        let formattedR = formatChannelValue(lastR, currentMode, currentValueFormat);
        
        document.getElementById('ch1Val').innerHTML = `L: ${formattedL}`;
        document.getElementById('ch2Val').innerHTML = `R: ${formattedR}`;
    };
	
	document.getElementById('saveUrlBtn').onclick = () => {
		saveStateToURL();
	};
document.getElementById('exportWavBtn').onclick = () => {
    const input = document.getElementById('exportSamplesInput');
    const numSamples = parseInt(input.value) || 40000;
    const stereo = document.getElementById('stereoCheckbox').checked;
    
    if (workletNode && workletNode.port) {
        workletNode.port.postMessage({
            type: 'exportWav',
            numSamples: numSamples,
            stereo: stereo
        });
    }
};
    
    const srInput = document.getElementById('sampleRateInput');
    srInput.oninput = async () => {
        currentSampleRate = parseInt(srInput.value);
		if (workletNode && workletNode.port) {
			workletNode.port.postMessage({
				type: 'updateRate',
				genRate: currentSampleRate
			});
		}
    };
    
    window.editor.on('changes', () => {
        // updateCode();
    });
    
    await initAudio();
	updateCode();
    drawWave();
    
    if (audioCtx && audioCtx.state !== 'suspended') {
        await audioCtx.suspend();
    }
    isPlaying = false;
    document.getElementById('playPauseBtn').innerHTML = '▶';
    
    updateTDisplay();
};

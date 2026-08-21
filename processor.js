// Bytebeat AudioWorkletProcessor

class BytebeatProcessor extends AudioWorkletProcessor {
    static get outputChannelCount() {
        return [2];
    }
    
    constructor() {
        super();
        this.t = 0;
        this.phase = 0;
        this.lastL = 0;
        this.lastR = 0;
        this.genRate = 8000;
        this.mode = 'bytebeat';
        this.syntax = 'infix';
        this.userFunc = null;
        this.visBufferL = [];
        this.visBufferR = [];
		
		this.mouseX = 0; this.mouseY = 0;
		this.tiltX = 0; this.tiltY = 0; this.compass = 0;
		this.width = 0; this.height = 0;
		
		if (typeof globalThis.window === 'undefined') {
			globalThis.window = {};
		}
        
        this.port.onmessage = (e) => {
            if (e.data.type === 'reset') {
                this.t = 0;
                this.phase = 0;
            } else if (e.data.type === 'update') {
                try {
					const savedWindow = { ...globalThis.window };
					
                    this.mode = e.data.mode;
                    this.syntax = e.data.syntax;
					this.genRate = e.data.genRate;
                    if (e.data.currentT !== undefined) {
                        this.t = e.data.currentT;
                    }
                    let funcStr = e.data.func;
                    
                    if (this.syntax === 'infix') {
                        this.userFunc = new Function('t', 'sampleRate', 'extra', 'var window = globalThis.window || {}; Object.getOwnPropertyNames(Math).forEach(prop => {globalThis[prop] = Math[prop];}); Object.getOwnPropertyNames(extra).forEach(prop => {globalThis[prop] = extra[prop]});  const int = floor; return (' + funcStr + ')');
                    } else if (this.syntax === 'function') {
                        this.userFunc = new Function('t', 'sampleRate', 'extra', 'var window = globalThis.window || {}; Object.getOwnPropertyNames(Math).forEach(prop => {globalThis[prop] = Math[prop];}); Object.getOwnPropertyNames(extra).forEach(prop => {globalThis[prop] = extra[prop]});  const int = floor;' + funcStr);
                    }
                } catch(err) {
                    this.port.postMessage({
                        type: 'error',
                        message: err.message || err.toString()
                    });
                    this.userFunc = null;
                }
            } else if (e.data.type === 'sensors') { 
        this.mouseX = e.data.data.mouseX;
        this.mouseY = e.data.data.mouseY;
        this.tiltX = e.data.data.tiltX;
        this.tiltY = e.data.data.tiltY;
        this.compass = e.data.data.compass;
        this.width = e.data.data.width;
        this.height = e.data.data.height
    } else if (e.data.type === 'updateRate') {
    this.genRate = e.data.genRate;
} else if (e.data.type === 'init') {
    this.mode = e.data.mode || 'bytebeat';
    this.syntax = e.data.syntax || 'infix';
    this.genRate = e.data.genRate || 8000;
    if (e.data.currentT !== undefined) {
        this.t = e.data.currentT;
    }
}
        };
    }
    
    remapSample(value, mode) {
        let leftVal, rightVal;
        
        if (Array.isArray(value)) {
            if (value.length >= 2) {
                leftVal = value[0];
                rightVal = value[1];
            } else if (value.length === 1) {
                leftVal = value[0];
                rightVal = value[0];
            } else {
                leftVal = 0;
                rightVal = 0;
            }
        } else {
            leftVal = value;
            rightVal = value;
        }
        
        let left = this.remapSingle(leftVal, mode);
        let right = this.remapSingle(rightVal, mode);
        
        return [left, right];
    }
    
    remapSingle(num, mode) {
        let val = Number(num);
        if (isNaN(val)) val = 0;
        switch(mode) {
            case 'bytebeat':
                let u = Math.floor(val) & 0xFF;
                return (u / 127.5) - 1.0;
            case 'signed':
                let s = Math.floor(val) & 0xFF;
                if (s > 127) s = s - 256;
                return Math.max(-1, Math.min(1, s / 127.0));
            case 'bitbeat':
                return (Math.floor(Math.abs(val)) & 1) ? 1.0 : -1.0;
            case 'floatbeat':
                return val;
            default: return 0;
        }
    }
    
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        if (!output || output.length < 2) return true;
        
        const outL = output[0];
        const outR = output[1];
        if (!outL || !outR) return true;
        
        const targetRate = sampleRate;
        const blockSize = outL.length;
        
        for (let i = 0; i < blockSize; i++) {
            if (this.phase < 1.0) {
                let leftRaw = 0;
                let rightRaw = 0;
                
                if (this.userFunc) {
                    try {
                        let timeValue;
                        if (this.syntax === 'function') {
                            timeValue = this.t / this.genRate;
                        } else {
                            timeValue = this.t;
                        }
						
                        let extra = {
							mouseX: this.mouseX,
							mouseY: this.mouseY,
							tiltX: this.tiltX,
							tiltY: this.tiltY,
							compass: this.compass,
							width: this.width,
							height: this.height,
							int: Math.floor
						};

        let result = this.userFunc(timeValue, this.genRate, extra);
        if (typeof result === 'function') {
            result = result(timeValue, this.genRate, extra, 0);
        }
        
        if (Array.isArray(result)) {
            leftRaw = result[0] || 0;
            rightRaw = result[1] !== undefined ? result[1] : result[0];
        } else {
            leftRaw = Number(result) || 0;
            rightRaw = leftRaw;
        }
                        
                        if (isNaN(leftRaw)) leftRaw = 0;
                        if (isNaN(rightRaw)) rightRaw = 0;
                    } catch(e) {
                        this.port.postMessage({
                            type: "error",
                            message: e.message || e.toString()
                        });
                        leftRaw = 0;
                        rightRaw = 0;
                    }
                }
                
                this.lastL = this.remapSingle(leftRaw, this.mode);
                this.lastR = this.remapSingle(rightRaw, this.mode);
                this.phase += targetRate / this.genRate;
                this.t++;
            }
            
            outL[i] = this.lastL;
            outR[i] = this.lastR;
            this.phase -= 1.0;
            
            this.visBufferL.push(this.lastL);
            this.visBufferR.push(this.lastR);
        }
        
        if (this.visBufferL.length >= 256) {
            this.port.postMessage({
                type: 'vis',
                l: this.visBufferL,
                r: this.visBufferR,
                t: this.t
            });
            this.visBufferL = [];
            this.visBufferR = [];
        }
        
        return true;
    }
}

registerProcessor('bytebeat-processor', BytebeatProcessor);
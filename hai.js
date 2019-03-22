
//require('browser-env')();
 
// Now you have access to a browser like environment in Node.js:
 
//typeof window;
// 'object'


//const mm = require('@magenta/music');
//const tf = require('@tensorflow/tfjs-node');

var now = require("performance-now")	
const { exec } = require('child_process');
const { fork } = require('child_process');

const Max = require('max-api');
var stepSequencer = require("./sequencer");

 
var NS_HEADER = {
    ticksPerQuarter: 220,
    totalTime: 1.5,
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
    tempos: [{ time: 0, qpm: 120 }]
	};
	
var MELODY_NS = {
    ticksPerQuarter: 220,
    totalTime: 1.5,
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
    tempos: [{ time: 0, qpm: 120 }],
    notes: [
        {
            instrument: 0,
            program: 0,
            startTime: 0,
            endTime: 0.5,
            pitch: 60,
            velocity: 100,
            isDrum: false
        },
        {
            instrument: 0,
            program: 0,
            startTime: 0.5,
            endTime: 1.0,
            pitch: 60,
            velocity: 100,
            isDrum: false
        },
        {
            instrument: 0,
            program: 0,
            startTime: 1.0,
            endTime: 1.5,
            pitch: 67,
            velocity: 100,
            isDrum: false
        },
        {
            instrument: 0,
            program: 0,
            startTime: 1.5,
            endTime: 2.0,
            pitch: 67,
            velocity: 100,
            isDrum: false
        }
    ]
};

//==== MAX HANDLERS
Max.addHandler("bang", () => {

	magThread.send ({run : MELODY_NS});
});

Max.addHandler("note", (pitch, vel) => {
	Max.post('pitch' + pitch + ' - ' + vel);
	if (vel === 0){
		ss.noteOff(pitch,now());
	} else {
		ss.noteOn(pitch,vel,now());
	}
});

Max.addHandler("tic", (pitch, vel) => {
    ss.advance()
});


	
	
function startFileServer(){
	Max.post('start fileserver');
	exec('/Users/hermannbauerecker/Music/HAI/max/node_modules/http-server/bin/http-server /Users/hermannbauerecker/file-serve', (err, stdout, stderr) => {
  	if (err) {
    	Max.post('fileserver stopped with error ' + err);
    	return;
  	}

  	// the *entire* stdout and stderr (buffered)
  	Max.post(`stdout: ${stdout}`);
  	Max.post(`stderr: ${stderr}`);
	});
}

function emmitSeq(seq){
    Max.post(seq.notes);
    ss.setSequence(seq.quantizationInfo.stepsPerQuarter, seq.notes)

	// Begin playing the sequence
	ss.play();
}


// main
var tempo = 120;
var division = 4;

var ss = new stepSequencer(	tempo, division, 20)
//==== sequencer events
ss.on('n', function (step) {
		Max.post('send note');
		Max.post(step);
		Max.outlet([step.pitch, 127, ( step.quantizedEndStep - step.quantizedStartStep ) ]);
})

ss.on('o', function (ns) {
		Max.post('got sequence');
       	magThread.send({run: ns});		
})

								
// node-fetch needs urls, so just serce files
startFileServer();

// put all heavy stuff to separate thread
const magThread = fork('magenta.js', [], { silent: true });

magThread.send ({init : 'true'});

magThread.on('message', (msg) => {
  	Max.post('Message from child', msg);
  	if (msg.cont){
		Max.post('start seq');
		emmitSeq(msg.cont);
	}
});

magThread.stdout.on('data', (data) => { Max.post('LOG: ' + data.toString('utf8'))})
magThread.stderr.on('data', (data) => { Max.post('ERR: ' + data.toString('utf8'))})
//rnn=initMagenta();
//rnn.dispose();


const tf = require('@tensorflow/tfjs-node');
const mm = require('../magenta-js/music');


// node needs a fileserver to serve the model
const CHECKPOINTS_DIR = 'http://127.0.0.1:8081/models';
const MEL_CHECKPOINT = `${CHECKPOINTS_DIR}/music_rnn/chord_pitches_improv`;

mm.logging.verbosity = mm.logging.Level.DEBUG;


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

var rnn;

function initMagenta(){
	const improvRnn = new mm.MusicRNN(MEL_CHECKPOINT);
    improvRnn.initialize();
	return improvRnn;
}

async function runDrumsRnn() {
  // Display the input.
  const qns = mm.sequences.quantizeNoteSequence(DRUMS_NS, 4);

  const drumsRnn = new mm.MusicRNN(DRUMS_CHECKPOINT);
  await drumsRnn.initialize();

  const start = performance.now();
  const continuation = await drumsRnn.continueSequence(qns, 20);
  drumsRnn.dispose();
}

async function runImprovRnn() {
  // Display the input.
  const qns = mm.sequences.quantizeNoteSequence(MELODY_NS, 4);
  
  const start = performance.now();
  const continuation = await improvRnn.continueSequence(qns, 20, 1.0, ['Cm']);
  improvRnn.dispose();
}

async function runMelodyRnn(ns) {
  // Display the input.
  const qns = mm.sequences.quantizeNoteSequence(MELODY_NS, 4);
//  Max.post('run RNN model');
//  process.send ({'ns': qns});
  
  const continuation = rnn.continueSequence(qns, 20,1.0, ['Cm']);
//  Max.post("now sequence"); 
//  Max.post(continuation);
  continuation.then (function (continuation){
	//Max.post('now we output');
	process.send ({'cont': continuation});
  	//emmitSeq(continuation);
  })
  
}

process.on('message', (msg) => {
	//	Max.post('got message ' + msg);
	if (msg.init){
		rnn=initMagenta();
		process.send ({'ns': 'initialized'});
	} else if (msg.run){
		runMelodyRnn(msg.run);
		//process.send ({'ns': msg.run});
		
	}
});

//rnn=initMagenta]
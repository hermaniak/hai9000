
import * as pm from './perf_rnn_model';
import now = require('performance-now');

const GENERATION_BUFFER_SECONDS = .5;
//const GENERATION_BUFFER_SECONDS = 5;

// If we're this far behind, reset currentTime time to piano.now().
const MAX_GENERATION_LAG_SECONDS = 1;
// If a note is held longer than this, release it.
const MAX_NOTE_DURATION_SECONDS = 3;

let globalGain = 127;
let currentVelocity = 100;
let globalTempoFactor = 1;

const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;
const VELOCITY_BINS = 32;
const MAX_SHIFT_STEPS = 100;
const STEPS_PER_SECOND = 100;
const TEMPO_FACTOR = 5;

let prnn: pm.PerformanceRNN;

let play = false;

const activeNotes = new Map<number, number>();
let currentLoopId = 0;
let currentPianoTimeSec = 0;

// When the piano roll starts in browser-time via performance.now().
let pianoStartTimestampMs = 0;

const EVENT_RANGES = [
  ['note_on', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
  ['note_off', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
  ['time_shift', 1, MAX_SHIFT_STEPS],
  ['velocity_change', 1, VELOCITY_BINS],
];

function calculateEventSize(): number {
  let eventOffset = 0;
  for (const eventRange of EVENT_RANGES) {
    const minValue = eventRange[1] as number;
    const maxValue = eventRange[2] as number;
    eventOffset += maxValue - minValue + 1;
  }
  return eventOffset;
}


function playOutput(index: number) {
    let offset = 0;
    for (const eventRange of EVENT_RANGES) {
      const eventType = eventRange[0] as string;
      const minValue = eventRange[1] as number;
      const maxValue = eventRange[2] as number;
      if (offset <= index && index <= offset + maxValue - minValue) {
        if (eventType === 'note_on') {
          const noteNum = index - offset;
          console.log(`event ${eventType} - ${index - offset} - ${currentVelocity.toFixed(2)} * ${globalGain} - ${currentPianoTimeSec.toFixed(2)} - ${now().toFixed(2)}`);
	  setTimeout(() => {
            process.send ({'noteon': [noteNum, Math.min(Math.floor(currentVelocity * globalGain), 127),
                Math.floor(1000 * currentPianoTimeSec) - pianoStartTimestampMs]});
            setTimeout(() => {
              process.send({'noteoff': [noteNum, 0,
                Math.floor(currentPianoTimeSec * 1000) - pianoStartTimestampMs]});
            }, 100);
          }, (currentPianoTimeSec - now()/1000) * 1000);
          activeNotes.set(noteNum, currentPianoTimeSec);
          return;
        } else if (eventType === 'note_off') {
          const noteNum = index - offset;
          const activeNoteEndTimeSec = activeNotes.get(noteNum);
          activeNotes.delete(noteNum);
          // If the note off event is generated for a note that hasn't been
          // pressed, just ignore it.
          if (activeNoteEndTimeSec == null) {
             return;
          } 
          const timeSec = Math.max(currentPianoTimeSec, activeNoteEndTimeSec + .5);
          //console.log(`event ${eventType} - ${index - offset} - ${currentVelocity.toFixed(2)} - ${currentPianoTimeSec.toFixed(2)} - ${now().toFixed(2)}`);

	  process.send({'noteoff': [noteNum, 0,
                Math.floor(timeSec * 1000) - pianoStartTimestampMs]});

          return;
        } else if (eventType === 'time_shift') {
          currentPianoTimeSec += (index - offset + 1) / STEPS_PER_SECOND * globalTempoFactor;
	  console.log(`event ${eventType} - ${index - offset + 1} - ${(index - offset + 1) / STEPS_PER_SECOND * globalTempoFactor} - ${currentVelocity.toFixed(2)} - ${currentPianoTimeSec.toFixed(2)} - ${now().toFixed(2)}`);
          activeNotes.forEach((timeSec, noteNum) => {
            if (currentPianoTimeSec - timeSec > MAX_NOTE_DURATION_SECONDS) {
              console.info(
                `Note ${noteNum} has been active for ${
                   currentPianoTimeSec - timeSec}, ` +
                  `seconds which is over ${MAX_NOTE_DURATION_SECONDS}, will ` +
                `release.`);
                activeNotes.delete(noteNum);
                process.send({'noteoff': [noteNum, 0,-1]});
            }
          });
          return currentPianoTimeSec;
        } else if (eventType === 'velocity_change') {
          currentVelocity = (index - offset + 1) * Math.ceil(127 / VELOCITY_BINS);
          currentVelocity = currentVelocity / 127;
          return currentVelocity;
        } else {
          throw new Error('Could not decode eventType: ' + eventType);
        }
      }
      offset += maxValue - minValue + 1;
    }
    throw new Error(`Could not decode index: ${index}`);
  }

async function generate(loopId: number) {
    if (play != true){
	return 
    }
    let outputs: number[];
    if (loopId < currentLoopId) {
      // Was part of an outdated generateStep() scheduled via setTimeout.
      return;
    }
    outputs=prnn.generateStep();
    for (let i = 0; i < outputs.length; i++) {
        //console.log(outputs[i]);
        playOutput(outputs[i]);
    }
    let nowSec=now()/1000.
    if ((nowSec - currentPianoTimeSec) > MAX_GENERATION_LAG_SECONDS) {
      console.warn(
          `Generation is ${nowSec - currentPianoTimeSec} seconds behind, ` +
          `which is over ${MAX_NOTE_DURATION_SECONDS}. Resetting time!`);
      currentPianoTimeSec = nowSec;
    }
    const delta = Math.max(
        0, currentPianoTimeSec - nowSec - GENERATION_BUFFER_SECONDS);
    console.log(`Played ${outputs.length} - now gGenerate new notes in ${delta} secs`);
    setTimeout(() => generate(loopId), delta * 1000);
}


process.on('message', (msg) => {
   if (msg.init){
        prnn = new pm.PerformanceRNN('http://127.0.0.1:8010/models/performance_rnn');
        console.log('initialize');
        prnn.initialize();
        process.send ({'ns': 'initialized'});
   }
   else if (msg.start){
	if (prnn.isReady()){
		play=true;
 		currentPianoTimeSec = now()/1000;
        	prnn.reset();
		currentLoopId++;
		generate(currentLoopId);
		process.send ({'info': 'reset!'});
	}else{
        	process.send ({'error': 'Tensorflow not ready!'});
	}
   } 
   else if (msg.stop){
	play = false;
   }
   else if (msg.tempo){
	globalTempoFactor = msg.tempo;
   }
   else if (msg.gain){
	globalGain=msg.gain;
   }
   else if (msg.noteDensity){
        prnn.updateNoteDensity(msg.noteDensity);
   }
   else if (msg.condition){
	prnn.updatePitchHistogram(msg.condition[0],msg.condition[1]);
   }
})

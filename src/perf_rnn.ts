
import * as pm from './perf_rnn_model';
import now = require('performance-now');

const GENERATION_BUFFER_TIME = 500;

// If we're this far behind, reset currentTime time to piano.now().
const MAX_GENERATION_LAG = 1000;
// If a note is held longer than this, release it.
const MAX_NOTE_DURATION = 3000;

let globalGain = 127;
let currentVelocity = 100;
let globalTempoFactor = 1.;
let resetCnt=20;

const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;
const VELOCITY_BINS = 32;
const MAX_SHIFT_STEPS = 100;
const STEPS_PER_SECOND = 100;
const MS_PER_STEP = 10
const TEMPO_FACTOR = 1.;

let prnn: pm.PerformanceRNN;

let play = false;

const activeNotes = new Map<number, number>();
let currentLoopId = 0;
let currentPianoTime = 0;
let notesBufferCnt = 0;
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
          //console.log(`event ${eventType} - ${index - offset} - ${currentVelocity.toFixed(2)} * ${globalGain} - ${currentPianoTime.toFixed(2)} - ${now().toFixed(2)}`);
          notesBufferCnt++;
          //console.log(`${Math.floor(now())}: ${notesBufferCnt} - note on in ${Math.floor(currentPianoTime - now())} ms`);
	  setTimeout(() => {
	    notesBufferCnt--;
            //console.log(`${Math.floor(now())} - ${notesBufferCnt} - note on`);
            process.send ({'noteon': [noteNum, Math.min(Math.floor(currentVelocity * globalGain), 127),
                Math.floor(currentPianoTime) - pianoStartTimestampMs]});
            //setTimeout(() => {
              //process.send({'noteoff': [noteNum, 0,currentPianoTime - pianoStartTimestampMs]});
            //}, 100);
          }, (currentPianoTime - now()));
          activeNotes.set(noteNum, currentPianoTime);
          return;
        } else if (eventType === 'note_off') {
          const noteNum = index - offset;
          const activeNoteEndTime = activeNotes.get(noteNum);
          activeNotes.delete(noteNum);
          // If the note off event is generated for a note that hasn't been
          // pressed, just ignore it.
          if (activeNoteEndTime == null) {
             return;
          } 
          const timeMs = Math.max(currentPianoTime, activeNoteEndTime + .5);
          //console.log(`event ${eventType} - ${index - offset} - ${currentVelocity.toFixed(2)} - ${currentPianoTimeSec.toFixed(2)} - ${now().toFixed(2)}`);

	  process.send({'noteoff': [noteNum, 0,
                Math.floor(timeMs) - pianoStartTimestampMs]});

          return;
        } else if (eventType === 'time_shift') {
          currentPianoTime += (index - offset + 1) * MS_PER_STEP * globalTempoFactor;
	  //console.log(`event ${eventType} - ${index - offset + 1} - ${(index - offset + 1) / MS_PER_STEP * globalTempoFactor} - ${currentPianoTime.toFixed(2)} - ${now().toFixed(2)}`);
          activeNotes.forEach((timeMs, noteNum) => {
            if (currentPianoTime - timeMs > MAX_NOTE_DURATION) {
              console.info(
                `Note ${noteNum} has been active for ${
                   currentPianoTime - timeMs}, ` +
                  `seconds which is over ${MAX_NOTE_DURATION}, will ` +
                `release.`);
                activeNotes.delete(noteNum);
                process.send({'noteoff': [noteNum, 0,-1]});
            }
          });
          return currentPianoTime;
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
    if ((now() - currentPianoTime) > MAX_GENERATION_LAG) {
      console.warn(
          `Generation is ${now()} - currentPianoTime} ms behind, ` +
          `which is over ${MAX_GENERATION_LAG}. Resetting time!`);
      currentPianoTime = now();
    }
    const delta = Math.max(
        0, currentPianoTime - now() - GENERATION_BUFFER_TIME);
    console.log(`LoopId ${loopId} - Played ${outputs.length} - now gGenerate new notes in ${delta} secs`);
    if (loopId > resetCnt){
	console.log(`LoopId > resetCnt ${resetCnt} - RESET MODEL!`);
	prnn.reset();
    }
    setTimeout(() => generate(loopId), delta);
}


process.on('message', (msg) => {
   if (msg.init){
        prnn = new pm.PerformanceRNN(msg.init);
        console.log('initialize');
        prnn.initialize();
        process.send ({'status': -1});
   }
   else if (msg.start){
	if (prnn.isReady()){
		play=true;
 		currentPianoTime = now();
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
   else if (msg.resetCnt){
	resetCnt=msg.resetCnt;
   }
   else if (msg.noteDensity){
        prnn.updateNoteDensity(msg.noteDensity);
   }
   else if (msg.condition){
	prnn.updatePitchHistogram(msg.condition[0],msg.condition[1]);
   }
})

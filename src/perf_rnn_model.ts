/* Copyright 2017 Google Inc. All Rights Reserved.
  
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/


import * as tf from '@tensorflow/tfjs-node';

// tfjs-node does note proved weightsManifestConfig, get it directly from core...
import * as tfIoTypes from '@tensorflow/tfjs-core/src/io/types';
import  node_fetch from 'node-fetch';
import now = require('performance-now');

// tslint:disable-next-line:no-require-imports

let lstmKernel1: tf.Tensor2D;
let lstmBias1: tf.Tensor1D;
let lstmKernel2: tf.Tensor2D;
let lstmBias2: tf.Tensor1D;
let lstmKernel3: tf.Tensor2D;
let lstmBias3: tf.Tensor1D;
let c: tf.Tensor2D[];
let h: tf.Tensor2D[];
let fcB: tf.Tensor1D;
let fcW: tf.Tensor2D;
const forgetBias = tf.scalar(1.0);
const activeNotes = new Map<number, number>();

// How many steps to generate per generateStep call.
// Generating more steps makes it less likely that we'll lag behind in note
// generation. Generating fewer steps makes it less likely that the browser UI
// thread will be starved for cycles.
const STEPS_PER_GENERATE_CALL = 10;
// How much time to try to generate ahead. More time means fewer buffer
// underruns, but also makes the lag from UI change to output larger.
const GENERATION_BUFFER_SECONDS = .5;
// If we're this far behind, reset currentTime time to piano.now().
const MAX_GENERATION_LAG_SECONDS = 1;
// If a note is held longer than this, release it.
const MAX_NOTE_DURATION_SECONDS = 3;

const NOTES_PER_OCTAVE = 12;
const DENSITY_BIN_RANGES = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0];
const PITCH_HISTOGRAM_SIZE = NOTES_PER_OCTAVE;

const RESET_RNN_FREQUENCY_MS = 30000;

let currentVelocity = 100;

const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;
const VELOCITY_BINS = 32;
const MAX_SHIFT_STEPS = 100;
const STEPS_PER_SECOND = 100;

const MIDI_EVENT_ON = 0x90;
const MIDI_EVENT_OFF = 0x80;
const MIDI_NO_OUTPUT_DEVICES_FOUND_MESSAGE = 'No midi output devices found.';
const MIDI_NO_INPUT_DEVICES_FOUND_MESSAGE = 'No midi input devices found.';

const MID_IN_CHORD_RESET_THRESHOLD_MS = 1000;

let pitchHistogramEncoding: tf.Tensor1D;
let noteDensityEncoding: tf.Tensor1D;
let conditioned = false;

let currentPianoTimeSec = 0;
// When the piano roll starts in browser-time via performance.now().
let pianoStartTimestampMs = 0;

const EVENT_RANGES = [
  ['note_on', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
  ['note_off', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
  ['time_shift', 1, MAX_SHIFT_STEPS],
  ['velocity_change', 1, VELOCITY_BINS],
];

const LOG_LEVEL_STR = ['ERROR','WARNING','INFO','DEBUG'];

function calculateEventSize(): number {
  let eventOffset = 0;
  for (const eventRange of EVENT_RANGES) {
    const minValue = eventRange[1] as number;
    const maxValue = eventRange[2] as number;
    eventOffset += maxValue - minValue + 1;
  }
  return eventOffset;
}

const notes = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'];


let preset1 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
let preset2 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

const EVENT_SIZE = calculateEventSize();

const PRIMER_IDX = 355;
let lastSample = tf.scalar(PRIMER_IDX, 'int32');

// The unique id of the currently scheduled setTimeout loop.
let currentLoopId = 0;

/**
 * Main PerformanceRNN model class.
 *
 * A PerformanceRNN is an LSTM-based language model for musical notes.
 */
export class PerformanceRNN {
  private checkpointURL: string;
  private modelReady: boolean;
  isReady(){ return this.modelReady;}
  private conditioned = false;
  private pitchHistogram = preset1;
  private logLevel = 1;
  private noteDensityIdx = 4;
//  private lstmKernel1: tf.Tensor2D;
//  private lstmBias1: tf.Tensor1D;
//  private lstmKernel2: tf.Tensor2D;
//  private lstmBias2: tf.Tensor1D;
//  private lstmKernel3: tf.Tensor2D;
//  private lstmBias3: tf.Tensor1D;
//  private c: tf.Tensor2D[];
//  private h: tf.Tensor2D[];
//  private fcB: tf.Tensor1D;
//  private fcW: tf.Tensor2D;
//  private lastSample = tf.scalar(PRIMER_IDX, 'int32');

  reset() {
    c = [
      tf.zeros([1, lstmBias1.shape[0] / 4]),
      tf.zeros([1, lstmBias2.shape[0] / 4]),
      tf.zeros([1, lstmBias3.shape[0] / 4]),
    ];
    h = [
      tf.zeros([1, lstmBias1.shape[0] / 4]),
      tf.zeros([1, lstmBias2.shape[0] / 4]),
      tf.zeros([1, lstmBias3.shape[0] / 4]),
    ];
    if (lastSample != null) {
      lastSample.dispose();
    }
    lastSample = tf.scalar(PRIMER_IDX, 'int32');
    currentPianoTimeSec = now();
    pianoStartTimestampMs = now() - currentPianoTimeSec * 1000;
    //currentLoopId++;
    //this.generateStep(currentLoopId);
  }

  private consolelog(level: number, log: string){
	if (level >= this.logLevel){
		console.log(`${LOG_LEVEL_STR[this.logLevel]}: ${log}`)
	}
  }

  updateNoteDensity(noteDensityIdx: number){
	this.noteDensityIdx=noteDensityIdx;
	this.consolelog(4,`updated noteDensityIdx to ${this.noteDensityIdx}`);
  }

  updatePitchHistogram(bin: number, vel: number) {
    this.pitchHistogram[bin]=vel;
    this.updateConditioningParams();
    this.consolelog(4,`updated Pitch Histogram to ${this.pitchHistogram}`);
  }

  private  updateConditioningParams() {

    if (noteDensityEncoding != null) {
      noteDensityEncoding.dispose();
      noteDensityEncoding = null;
    }

    const noteDensity = DENSITY_BIN_RANGES[this.noteDensityIdx];

    noteDensityEncoding =
      tf.oneHot(
          tf.tensor1d([this.noteDensityIdx + 1], 'int32'),
          DENSITY_BIN_RANGES.length + 1).as1D();

    if (pitchHistogramEncoding != null) {
      pitchHistogramEncoding.dispose();
      pitchHistogramEncoding = null;
    }
    const buffer = tf.buffer<tf.Rank.R1>([PITCH_HISTOGRAM_SIZE], 'float32');
    const pitchHistogramTotal = this.pitchHistogram.reduce((prev, val) => {
      return prev + val;
    });
    for (let i = 0; i < PITCH_HISTOGRAM_SIZE; i++) {
      console.log(this.pitchHistogram[i] / pitchHistogramTotal);
      buffer.set(this.pitchHistogram[i] / pitchHistogramTotal, i);
    }
    pitchHistogramEncoding = buffer.toTensor();
    console.log(`conditioning -- density: ${this.noteDensityIdx + 1}, pitchhist: ${buffer}`)
  }

  private getConditioning(): tf.Tensor1D {
    return tf.tidy(() => {
      if (!conditioned) {
        // TODO(nsthorat): figure out why we have to cast these shapes to numbers.
        // The linter is complaining, though VSCode can infer the types.
        const size = 1 + (noteDensityEncoding.shape[0] as number) +
            (pitchHistogramEncoding.shape[0] as number);
        const conditioning: tf.Tensor1D =
            tf.oneHot(tf.tensor1d([0], 'int32'), size).as1D();
        return conditioning;
      } else {
        const axis = 0;
        const conditioningValues =
            noteDensityEncoding.concat(pitchHistogramEncoding, axis);
        return tf.tensor1d([0], 'int32').concat(conditioningValues, axis);
      }
    });
  }

  /**
   *  Decode the output index and play it on the piano and keyboardInterface.
   */

  generateStep(){
    const lstm1 = (data: tf.Tensor2D, c: tf.Tensor2D, h: tf.Tensor2D) =>
      tf.basicLSTMCell(forgetBias, lstmKernel1, lstmBias1, data, c, h);
    const lstm2 = (data: tf.Tensor2D, c: tf.Tensor2D, h: tf.Tensor2D) =>
      tf.basicLSTMCell(forgetBias, lstmKernel2, lstmBias2, data, c, h);
    const lstm3 = (data: tf.Tensor2D, c: tf.Tensor2D, h: tf.Tensor2D) =>
      tf.basicLSTMCell(forgetBias, lstmKernel3, lstmBias3, data, c, h);

    let outputs: tf.Scalar[] = [];
    let outputCodes: number[] = [];
    [c, h, outputs] = tf.tidy(() => {
      // Generate some notes.
      const innerOuts: tf.Scalar[] = [];
      for (let i = 0; i < STEPS_PER_GENERATE_CALL; i++) {
        // Use last sampled output as the next input.
        const eventInput = tf.oneHot(
          lastSample.as1D(), EVENT_SIZE).as1D();
        // Dispose the last sample from the previous generate call, since we
        // kept it.
        if (i === 0) {
          lastSample.dispose();
        }
        const conditioning = this.getConditioning();
        const axis = 0;
        const input = conditioning.concat(eventInput, axis).toFloat();
        const output =
            tf.multiRNNCell([lstm1, lstm2, lstm3], input.as2D(1, -1), c, h);
        c.forEach(c => c.dispose());
        h.forEach(h => h.dispose());
        c = output[0];
        h = output[1];

        const outputH = h[2];
        const logits = outputH.matMul(fcW).add(fcB);

        const sampledOutput = tf.multinomial(logits.as1D(), 1).asScalar();

        innerOuts.push(sampledOutput);
        lastSample = sampledOutput;
      }
      return [c, h, innerOuts] as [tf.Tensor2D[], tf.Tensor2D[], tf.Scalar[]];
    });
    for (let i = 0; i < outputs.length; i++) {
	outputCodes[i]=outputs[i].dataSync()[0];
    }
    return outputCodes;
  }

  initialize() {
     this.logLevel=1;
     node_fetch(`${this.checkpointURL}/weights_manifest.json`)
      .then((response) => response.json())
      .then(
                         (manifest: tfIoTypes.WeightsManifestConfig) =>
                             tf.io.loadWeights(manifest, this.checkpointURL))
      .then((vars: {[varName: string]: tf.Tensor}) => {
        lstmKernel1 =
            vars['rnn/multi_rnn_cell/cell_0/basic_lstm_cell/kernel'] as
            tf.Tensor2D;
        lstmBias1 = vars['rnn/multi_rnn_cell/cell_0/basic_lstm_cell/bias'] as
            tf.Tensor1D;

        lstmKernel2 =
            vars['rnn/multi_rnn_cell/cell_1/basic_lstm_cell/kernel'] as
            tf.Tensor2D;
        lstmBias2 = vars['rnn/multi_rnn_cell/cell_1/basic_lstm_cell/bias'] as
            tf.Tensor1D;

        lstmKernel3 =
            vars['rnn/multi_rnn_cell/cell_2/basic_lstm_cell/kernel'] as
            tf.Tensor2D;
        lstmBias3 = vars['rnn/multi_rnn_cell/cell_2/basic_lstm_cell/bias'] as
            tf.Tensor1D;

        fcB = vars['fully_connected/biases'] as tf.Tensor1D;
        fcW = vars['fully_connected/weights'] as tf.Tensor2D;
        this.modelReady = true;
	console.log('model ready');
        this.updateConditioningParams()
        //this.resetRnn();
      });
  }

  /**
   * `PerformanceRNN` constructor.
   *
   * @param checkpointURL Path to the checkpoint directory.
   * @param spec (Optional) `MusicRNNSpec` object. If undefined, will be loaded
   * from a `config.json` file in the checkpoint directory.
   */
  constructor(checkpointURL: string) {
    this.checkpointURL = checkpointURL;
    this.modelReady = false; 
    console.warn('constructor');
  }
}



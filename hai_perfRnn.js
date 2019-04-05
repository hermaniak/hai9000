
//require('browser-env')();
 
// Now you have access to a browser like environment in Node.js:
 
//typeof window;
// 'object'


var now = require("performance-now");	
const fetch = require("node-fetch");
const { exec } = require('child_process');
const { fork } = require('child_process');

const Max = require('max-api');

// put all heavy stuff to separate thread
//const perfThread = fork('./es5/perf_rnn', [], { silent: true });
const perfThread = fork('./es5/perf_rnn.js', [], { silent: true });
 

function startFileServer(){
        fetch('http://127.0.0.1:8080/testServer')
            .catch( err => {
                                Max.post('start fileserver');
                                exec('/Users/hermannbauerecker/Music/HAI/max/node_modules/http-server/bin/http-server -p 8010 /Users/hermannbauerecker/file-serve', (err, stdout, stderr) => {
                                        if (err) {
                                        Max.post('fileserver stopped with error ' + err);
                                return;
                                        }

                                        // the *entire* stdout and stderr (buffered)
                                        Max.post(stdout);
                                        Max.post(`stdout: ${stdout}`);
                                        Max.post(`stderr: ${stderr}`);
                                }
                )});
}


// node-fetch needs urls, so just serce files
startFileServer();

//==== MAX HANDLERS
Max.addHandler("bang", () => {
	Max.post("generate some notes");
	perfThread.send ({start : true});
});

Max.addHandler("tempo", (tempo) => {
	Max.post('tempo change - ' + tempo);
	perfThread.send ({tempo: tempo});
});

Max.addHandler("gain", (gain) => {
	Max.post('gain change - ' + gain);
	perfThread.send ({gain: gain});
});

Max.addHandler("noteDensity", (noteDensity) => {
	Max.post('noteDensity change - ' + noteDensity);
	perfThread.send ({noteDensity: noteDensity});
});

Max.addHandler("start", () => {
		perfThread.send ({start : true});
});

Max.addHandler("stop", () => {
		perfThread.send ({stop : true});
});

Max.addHandler("condition", (...condition) => {
	Max.post('condition change - ' + JSON.stringify(condition));
	perfThread.send ({condition: condition});
});

Max.addHandler("resetCnt", (resetCnt) => {
	Max.post('reset cnt - ' + resetCnt);
	perfThread.send ({resetCnt: resetCnt});
});

Max.addHandler("tic", (pitch, vel) => {
    ss.advance()
});



perfThread.send ({init : 'http://127.0.0.1:8010/models/performance_rnn'});
//perfThread.send ({init : 'file:///Users/hermannbauerecker/Music/HAI/hai9000/models/performance_rnn'});

perfThread.on('message', (msg) => {
  	//Max.post('Message from child', msg);
  	if (msg.status){
		Max.outlet(msg.status);
	} else if (msg.noteon){
		//Max.post('note on - ', msg.noteon);
		Max.outlet(msg.noteon);
	} else if (msg.noteoff){
		//Max.post('notef off -', msg.noteoff);
		Max.outlet(msg.noteoff);
	} 
});

perfThread.stdout.on('data', (data) => { Max.post('LOG: ' + data.toString('utf8'))})
perfThread.stderr.on('data', (data) => { Max.post('ERR: ' + data.toString('utf8'))})

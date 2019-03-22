// midiHist.js
// time smoothed histogram of midi input

inlets=1
outlets=1


var lastTime;

function list(x){
	
			post(x);
}

function note(n, v, t){
	if (v > 0){
		post(n % 12,"-",v,"-",t,"-",t-lastTime,"\n");
		if ((t-lastTime) > 100){
			//reset histogram
			for(i=0;i<12;i++){
				outlet(0,i,0);
			}
		}
		outlet(0, n % 12, v)
		lastTime=t
    }
}
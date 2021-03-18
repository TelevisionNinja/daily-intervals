const { performance } = require('perf_hooks'); // for node js

module.exports = {
    setNoDriftTimeout,
    setNoDriftInterval,
    clearNoDrift
}

// array of IDs so that the timers can be cleared
const IDs = new Map();
// variable to keep track of and return a new ID
let newID = 1;

const rate = 0.9;

/**
 * this calls a function to get a timestamp
 * performance.now() is the default
 * 
 * @returns a timestamp
 */
function getTimestamp() {
    /*
    other timestamp functions

    -------------------------

    const time = process.hrtime();
    return time[0] * 1000 + time[1] / 1000000; // ms

    -------------------------

    return Number(process.hrtime.bigint() / 1000000n); // ms

    -------------------------

    return Date.now();
    */

    return performance.now();
};

//-------------------------------------------------------------------------
// timeout

/**
 * calls timeout until the time has been reached
 * 
 * @param {Function} callback 
 * @param {Number} end 
 * @param {Number} ID 
 */
function customTimeout(callback, end, ID) {
    IDs.set(
        ID,
        setTimeout(() => {
            if (end > getTimestamp()) {
                customTimeout(callback, end, ID);
            }
            else {
                callback();
            }
        }, rate * (end - getTimestamp()))
    );
}

/**
 * calls timeout until the time has been reached
 * 
 * @param {Function} callback 
 * @param {Number} ms 
 * @param  {...any} args 
 * @returns an ID
 */
function setNoDriftTimeout(callback, ms = 0, ...args) {
    customTimeout(() => {
        callback(...args);
    }, ms + getTimestamp(), newID);

    return newID++;
}

//-------------------------------------------------------------------------
// interval

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback 
 * @param {Number} time 
 * @param {Number} end 
 * @param {Number} ID 
 */
function customInterval(callback, time, end, ID) {
    IDs.set(
        ID,
        setTimeout(() => {
            if (end <= getTimestamp()) {
                callback();
                end += time;
            }

            customInterval(callback, time, end, ID);
        }, rate * (end - getTimestamp()))
    );
}

/**
 * calls timeout repeatedly
 * 
 * @param {Function} callback 
 * @param {Number} ms 
 * @param  {...any} args 
 * @returns an ID
 */
function setNoDriftInterval(callback, ms = 0, ...args) {
    customInterval(() => {
        callback(...args);
    }, ms, ms + getTimestamp(), newID);

    return newID++;
}

//-------------------------------------------------------------------------
// clear function

/**
 * cancels a no drift timeout or interval
 * 
 * @param {Number} ID 
 */
function clearNoDrift(ID) {
    clearTimeout(IDs.get(ID));
    IDs.delete(ID);
}
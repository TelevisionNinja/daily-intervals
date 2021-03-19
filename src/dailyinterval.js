const {
    setNoDriftTimeout,
    clearNoDrift
} = require('no-drift');

module.exports = class DailyInterval {
    // private vars
    #currentTime;
    #currentMs;
    #currentInterval;
    #timeoutID;

    // user's vars
    #func;
    #intervalStartTime;
    #interval;
    #offset;

    // timimg vars
    #timeRemaining;
    //#isNow;
    //#overshoot;
    //#undershoot;

    //----------------------------------------------------------------------------------
    // constructor

    /**
     * constructs the interval object
     * 
     * @param {Function} func func to execute at every interval
     * @param {String} intervalStartTime starting time of the intervals, format: h:m (24 hour)
     * @param {Number} interval minutes between intervals
     * @param {Number} offset ms offset
     */
    constructor(func, intervalStartTime, interval, offset = 0) {
        // user's vars
        this.func = func;
        this.intervalStartTime = intervalStartTime;
        this.interval = interval;
        this.offset = offset;

        // private vars
        this.#currentTime = 0;
        this.#currentMs = 0;
        this.#currentInterval = 0;
        this.#timeoutID = undefined;

        // timimg vars
        this.#timeRemaining = 0;
        //this.#isNow = false;
        //this.#overshoot = false;
        //this.#undershoot = false;
    }

    //----------------------------------------------------------------------------------
    // getters

    /**
     * returns the interval value
     */
    get interval() {
        return this.#interval;
    }

    /**
     * returns the interval starting time value
     */
    get intervalStartTime() {
        return this.#intervalStartTime;
    }

    get offset() {
        return this.#offset;
    }

    //----------------------------------------------------------------------------------
    // setters

    /**
     * sets the mins between intervals
     * the lowest value is 1
     * 
     * @param {Number} newInterval mins between intervals
     */
    set interval(newInterval) {
        // prevent less than 1 minute intervals
        if (newInterval < 1) {
            newInterval = 1;
        }

        this.#interval = newInterval;
    }

    /**
     * sets the function to be executed
     * 
     * @param {Function} newFunc function to be executed
     */
    set func(newFunc) {
        this.#func = newFunc;
    }

    /**
     * sets the starting time of the intervals
     * 
     * @param {String} newIntervalStartTime starting time of the intervals, format: h:m (24 hour)
     */
    set intervalStartTime(newIntervalStartTime) {
        const startTimeArr = newIntervalStartTime.split(':').map(i => parseInt(i));
        this.#intervalStartTime = 60 * startTimeArr[0] + startTimeArr[1];
    }

    set offset(newOffset) {
        this.#offset = newOffset;
    }

    //----------------------------------------------------------------------------------
    // private methods

    /**
     * calculates the ms left until the current interval
     * if the current time is the current interval, the 'isNow' boolean will be true, and the time remaining will be the provided interval
     * if the current time is after the current interval, the boolean 'overshoot' will be true, and the time remaining will be the time until the next interval
     * if the current time is before the current interval, the boolean 'undershoot' will be true, and the time remaining will be the time until the current interval
     * 
     * the time is 24 hr time
     */
    #getMsUntilIntervalTime() {
        // reset booleans
        //this.#isNow = false;
        //this.#overshoot = false;
        //this.#undershoot = false;

        let delta = this.#currentInterval - this.#currentTime;

        if (!delta) {
            // now
            delta = this.#interval;
            //this.#isNow = true;
        }
        else if (delta < 0) {
            // overshoot
            delta += (~~((0 - delta) / this.#interval) + 1) * this.#interval;
            //this.#overshoot = true;
        }

        this.#timeRemaining = 60000 * delta - this.#currentMs + this.#offset;
    }

    /**
     * calculates the next interval time based on the current time and the interval starting time
     */
    #calcNextIntervalTime() {
        /*
            // formula
            // 'interval' and 'startTime' are assumed to be in minutes
            // division is integer division

            // remove offset (startTime)
            delta = currentTime - startTime

            // assumed every day is 24 hours
            // add 24 hours in mins (carry) to negative numbers
            if (delta < 0) {
                delta += 1440
            }

            n = delta / interval + 1

            nextTime = interval * n + startTime

            // convert to hours and minutes

            newHr = nextTime / 60 % 24

            newMin = nextTime % 60
        */

        let delta = this.#currentTime - this.#intervalStartTime;

        if (delta < 0) {
            delta += 1440;
        }

        this.#currentInterval = ((~~(delta / this.#interval) + 1) * this.#interval + this.#intervalStartTime) % 1440;
    }

    /**
     * updates the current time in minutes and current second and millisecond in milliseconds
     */
    #updateTime() {
        const time = new Date();
        this.#currentTime = 60 * time.getHours() + time.getMinutes();
        this.#currentMs = 1000 * time.getSeconds() + time.getMilliseconds();
    }

    /**
     * creates the interval
     */
    #createInterval() {
        // update the time
        this.#updateTime();

        // calculate the next interval
        this.#calcNextIntervalTime();

        // calculate the time remaining until the next interval
        this.#getMsUntilIntervalTime();

        // wait until the interval time
        this.#timeoutID = setNoDriftTimeout(() => {
            // execute the function
            this.#func();

            this.#createInterval();
        }, this.#timeRemaining);
    }

    //----------------------------------------------------------------------------------
    // public methods

    /**
     * starts the interval
     * if the given start time is the current time, the function will be executed on the next interval
     * the time is 24 hr time
     * precision is of a minute
     * 
     * @param {Boolean} executeNow execute the function on the 'start()' call, default value is false
     */
    start(executeNow = false) {
        if (executeNow) {
            this.#func();
        }

        // create the interval
        this.#createInterval();
    }

    /**
     * stops the current running interval
     */
    stop() {
        // cancel the timeout
        clearNoDrift(this.#timeoutID);

        // clear private vars
        this.#currentTime = 0;
        this.#currentMs = 0;
        this.#currentInterval = 0;
        this.#timeoutID = undefined;

        // clear timimg vars
        this.#timeRemaining = 0;
        //this.#isNow = false;
        //this.#overshoot = false;
        //this.#undershoot = false;
    }
}

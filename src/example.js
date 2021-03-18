const DailyInterval = require('../src/dailyintervals.js');

const i = new DailyInterval(() => {
    console.log('hi');
}, '0:0', 1);

i.start(true);
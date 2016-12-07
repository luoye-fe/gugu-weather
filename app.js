const fs = require('fs');
const path = require('path');

const gm = require('gm');
const ejs = require('ejs');
const ora = require('ora');
const fetch = require('node-fetch');
const xml = require('xml2json');
const FormData = require('form-data');
const minimist = require('minimist');
const webshot = require('webshot');

const logger = require('./logger.js');
const config = require('./config.js');

// 获取命令行参数
const argv = minimist(process.argv.slice(2));

if (!argv.city) {
	logger.fatal('城市参数缺失');
	process.exit(1);
}

let cityID = 0;

JSON.parse(xml.toJson(fs.readFileSync('./cityID.xml', 'utf-8')))['root']['city'].forEach((item) => {
	if (item.name === argv.city) {
		cityID = item.id;
	}
});

if (cityID === 0) {
	logger.fatal('城市不存在');
	process.exit(1);
}

let shotOpts = {
	shotSize: {
		width: 700,
		height: 1532
	},
	shotOffset: {
		top: 282
	},
	quality: 100,
	timeout: 30000,
	streamType: 'jpg',
	customCSS: '* {color: #000!important;}',
	userAgent: 'Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_2 like Mac OS X; en-us) AppleWebKit/531.21.20 (KHTML, like Gecko) Mobile/7B298g'
}

// 获取网页完成图片
function getCompleteImg(from, to, opts) {
	return new Promise((resolve, reject) => {
		webshot(from, to, opts, function(err) {
			if (err) return reject(err);
			resolve();
		});
	});
}

// 生成自定义的一些图片
function generateCustomImg(city, time) {
	return new Promise((resolve, reject) => {
		ejs.renderFile('./headtpl.html', {
			city: city,
			time: time
		}, {}, function(err, str) {
			if (err) return reject(err);
			webshot(str, './temp/one.jpg', {
				siteType: 'html',
				shotSize: {
					width: 348,
					height: 44
				},
				quality: 100,
			}, function(err) {
				if (err) return reject(err);
				resolve();
			});
		});
	});
}

// 处理图片，拼接，位图转换等
function handleImg(to) {
	return new Promise((resolve, reject) => {
		// 取第一段
		function cropOne() {
			return new Promise(function(resolve, reject) {
				gm('./temp/complete.jpg')
					.crop(700, 300, 0, 0)
					.rotate('#fff', -90)
					.resize(348)
					.quality(100)
					.write('./temp/two.jpg', (err) => {
						if (err) return reject(err);
						resolve();
					});
			});
		}
		// 取第二段
		function cropTwo() {
			return new Promise(function(resolve, reject) {
				gm('./temp/complete.jpg')
					.crop(700, 300, 0, 300)
					.rotate('#fff', -90)
					.resize(348)
					.quality(100)
					.write('./temp/three.jpg', (err) => {
						if (err) return reject(err);
						resolve();
					});
			});
		}
		// 取第三段
		function cropThree() {
			return new Promise(function(resolve, reject) {
				gm('./temp/complete.jpg')
					.crop(700, 300, 0, 1226)
					.rotate('#fff', -90)
					.resize(348)
					.quality(100)
					.write('./temp/four.jpg', (err) => {
						if (err) return reject(err);
						resolve();
					});
			});
		}
		// 拼接自定义的和多段图片
		function append() {
			return new Promise(function(resolve, reject) {
				gm('./temp/one.jpg')
					.append('./temp/three.jpg')
					.append('./temp/four.jpg')
					.append('./temp/two.jpg')
					.quality(100)
					.write('./temp/result.jpg', (err) => {
						if (err) return reject(err);
						resolve();
					});
			});
		}
		Promise.all([cropOne(), cropTwo(), cropThree()])
			.then(() => {
				return append();
			})
			.then(() => {
				// 位图转换
				return new Promise((resolve, reject) => {
					gm('./temp/result.jpg')
						.resize(384)
						.flip()
						// .type('TrueColor')
						.monochrome()
						// .colors(2)
						.quality(100)
						// .write(to, (err) => {
						// 	if (err) reject(err);
						// 	resolve();
						// })
						.toBuffer('bmp', (err, buffer) => {
							if (err) reject(err);
							resolve(buffer.toString('base64'));
						})
				})
			})
			.then((encodeData) => {
				resolve(encodeData);
			})
			.catch((err) => {
				reject(err);
			});
	});
}

// encode
function encode(target) {
	return new Promise((resolve, reject) => {
		base64.encode(target, {
			string: true,
			local: true
		}, (err, data) => {
			resolve(data);
		})
	});
}

// 发送到咕咕鸡
function send(imgDate) {
	return new Promise((resolve, reject) => {
		const form = new FormData();
		form.append('memobirdID', config.memobirdID);
		form.append('userID', config.userID);
		form.append('printcontent', `P:${imgDate}`);
		fetch(`http://open.memobird.cn/home/printpaper?ak=${config.ak}&timestamp=${new Date().toLocaleDateString('ja-chinese', {year: "numeric", month: '2-digit', day: '2-digit'})}`, {
				method: 'POST',
				body: form
			})
			.then((res) => {
				return res.json();
			})
			.then((res) => {
				resolve();
			})
			.catch((e) => {
				reject(e);
			})
	});
}

async function main() {
	let beginTime = Date.now();
	let spinner = ora('获取完整图片 ...').start();
	try {
		await getCompleteImg(`http://www.weather.com.cn/weather1d/${cityID}.shtml`, './temp/complete.jpg', shotOpts);
	} catch (e) {
		spinner.stop();
		throw e;
	}
	spinner.stop();
	logger.success('获取完整图片成功');
	spinner.text = '生成自定义图片 ...';
	spinner.start();
	try {
		await generateCustomImg(argv.city, new Date().toLocaleDateString('ja-chinese', { year: "numeric", month: '2-digit', day: '2-digit' }));
	} catch (e) {
		spinner.stop();
		throw e;
	}
	spinner.stop();
	logger.success('生成自定义图片成功');
	spinner.text = '处理所有图片 ...';
	spinner.start();
	let target = `./result/${argv.city}-${new Date().toLocaleDateString('ja-chinese', {year: "numeric", month: '2-digit', day: '2-digit'})}.jpg`;
	let encodeData = '';
	try {
		encodeData = await handleImg(target);
	} catch (e) {
		spinner.stop();
		throw e;
	}
	spinner.stop();
	logger.success('处理图片成功');
	spinner.text = '发送给咕咕鸡 ...';
	spinner.start();
	try {
		await send(encodeData);
	} catch (e) {
		spinner.stop();
		throw e;
	}
	spinner.stop();
	logger.success('发送成功');
	logger.success(`花费时间：${Date.now() - beginTime} ms`);
}

(async function() {
	try {
		await main();
	} catch (e) {
		logger.fatal('出错了，重试');
		await main();
	}
})()

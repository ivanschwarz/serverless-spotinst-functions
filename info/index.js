"use strict";

const config = require("../config");
const chalk = require('chalk');
const path = require('path');
const utils = require("lodash");
const LocalFunctionsMapper = require("../utils/localFunctionsMapper");

class SpotinstInfo extends LocalFunctionsMapper {
	constructor(serverless, options){
		super();

		this.serverless = serverless;
		this.options = options || {};
		this.provider = this.serverless.getProvider(config.providerName);

		console.log(this.serverless)
		console.log(this.provider)

		this.setCommands();
		this.setHooks();
	}

	setCommands(){
		// this will be merged with the core config commands
		this.commands = {
			info: {
				lifecycleEvents: [
					'info',
				],
				options: {
					function: {
						usage: 'Function name.',
						shortcut: 'f'
					}
				}
			},
		};
	}

	setHooks(){
		this.hooks = {
			'before:info:info': _ => this.init(),
			'before:deploy:deploy': _ => this.init(),
			'before:deploy:function:deploy': _ => this.init(),
			'before:logs:logs': _ => this.init().then(_ => this.logs()),
			'info:info': _ => this.info(),
			'after:deploy:deploy': _ => this.info(),
			'after:deploy:function:deploy': _ => this.info()
		}
	}

	init(){
		this.provider.loadLocalParamsFile();
		this._client = this.provider.client.FunctionsService;

		return Promise.resolve();
	}

	info(){
		let funcs;

		if(this.options.function){
			funcs = this.getSingleFunction();

		} else {
			funcs = this.getAllFunctions();
		}

		return funcs
			.then(items => this.getEndpointPatterns(items))
			.then(items => this.getCronJobs(items))
			.then(items => this.logFunctions(items));
	}

	getSingleFunction(){
		const funcs = this.getLocalFunctions();
		const func = funcs[this.options.function] || funcs[`${this.options.function}-${this.options.stage}`];

		if(!func){
			throw new this.serverless.classes.Error(`Function '${this.options.f}' doesn't exist in this service.`);
		}

		let params = utils.extend({id: func.id}, this.provider.defaultParams);

		return this._client.read(params);
	}

	getAllFunctions(){
		let calls = [];
		const funcs = this.getLocalFunctions();

		utils.forEach(funcs, func => {
			const params = utils.extend({id: func.id}, this.provider.defaultParams);
			const call = this._client
				.read(params)
				.then( items => {
					let res = items[0];
					res.stage = func.stage;

					return res;
				});

			calls.push(call);
		});

		return Promise.all(calls)
			.then(funcs => funcs.filter(func => func)); // clear false values
	}

	getCronJobs(items){
		let calls = [];

		items.forEach(func => {
			const params = utils.extend({resourceId: func.id, action: "INVOKE_FUNCTION"}, this.provider.defaultParams);
			let call = this.provider.client.SpectrumService.Events.read(params)
				.then(res => func.cron = res[0]);

			calls.push(call);
		});

		return Promise.all(calls).then(_ => items).catch(e => items);
	}

	getEndpointPatterns(items){
		let call = this.provider.client.EndpointService.Pattern.list(this.provider.defaultParams)
			.then((res) => {
				res.forEach(endpoint => {
					items.forEach(func => {
						if(func.id == endpoint.functionId){
							func.endpoint = endpoint
						}
					})
				})
			})
		return Promise.all(call).then(_ => items).catch(e => items);
	}

	logFunctions(funcs){
		let messages = [];

		messages.push(`${chalk.yellow.underline('Service Information')}`);
		messages.push(`${chalk.yellow('service:')} ${this.serverless.service.service}`);

		if(funcs.length > 0){
			messages.push(`${chalk.yellow('functions:')}`);
			funcs.forEach(func => messages.push(this.logFunction(func)));

		} else {
			messages.push(`${chalk.yellow('None')}`);
		}

		this.serverless.cli.consoleLog(messages.join("\n"));
	}

	logFunction(func){
		let message = [];

		message.push(`  ${func.name}`);
		message.push(`    id: ${func.id}`);
		message.push(`    stage: ${func.stage}`);
		message.push(`    runtime: ${func.runtime}`);
		message.push(`    memory: ${func.limits.memory}`);
		message.push(`    timeout: ${func.limits.timeout}`);
		message.push(`    version: ${func.latestVersion}`);
		message.push(`    url: ${func.url}`);
		message.push(`    created_at: ${func.createdAt}`);

		if(func.cron){
			message.push(`    cron:`);
			message.push(`      active: ${func.cron.isEnabled}`);
			message.push(`      value: ${func.cron.cronExpression}`);
		}

		if(func.endpoint){
			message.push(`    endpoint:`);
			message.push(`      path: ${func.endpoint.pattern}`);
			message.push(`      method: ${func.endpoint.method}`);			
		}

		return message.join("\n");
	}

	logs(){
		let funcs = this.getSingleFunction();
		let message = [];

		funcs.then(item => {
			message.push(`${chalk.yellow('Name:')} ${item[0].name}`);
			message.push(`${chalk.yellow('Function ID:')} ${item[0].id}`);
			message.push(`${chalk.yellow('Current Version:')} ${item[0].latestVersion}`);

			this.serverless.cli.consoleLog(message.join("\n"));
		})
	}
}

module.exports = SpotinstInfo;
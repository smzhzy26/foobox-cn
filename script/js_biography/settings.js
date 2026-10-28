'use strict';

class Setting {
	constructor(key, default_value, type) {
		this.key = key;
		this.default_value = default_value;
		this.type = type;
		this.value = cfg.get(this.key, this.default_value, this.type);
	}

	// Methods

	get() {
		return this.value;
	}
	set(new_value) {
		if (this.value !== new_value) {
			switch (this.type) {
				case 'text':
					if (!new_value && new_value != this.default_value) {
						new_value = this.default_value;
					}
					break;
				case 'boolean':
					if (new_value !== true && new_value !== false) new_value = this.default_value;
					break;
				case 'num':
					new_value = parseInt(new_value);
					if (isNaN(new_value)) {
						new_value = this.default_value;
					}
					break;
			}
			cfg.set(this.key, new_value);
			this.value = new_value;
		}
	}
}

class Settings {
	constructor(name) {
		// this.key_list = {}; debug

		this.cfgBaseName = name;
		this.storageFolder = fb.ProfilePath + 'foobox\\data\\biography\\';
		$.buildPth(this.storageFolder);
		this.bio = `${this.storageFolder + this.cfgBaseName}.cfg`;
		this.item_properties = `${this.storageFolder}item_properties.json`;
		this.nowplaying = `${this.storageFolder}nowplaying.txt`;

		this.cfg = $.jsonParse(this.bio, {}, 'file-utf8'); // Regorxxx <- Force UTF-8 ->
		this.lfmSim = true;

		this.lang = {
			arr: ['EN', 'DE', 'ES', 'FR', 'IT', 'JA', 'PL', 'PT', 'RU', 'SV', 'TR', 'ZH'],
			ix: 0,
			ok: false
		}

		this.remap = {}
		this.pth = {}
		this.sup = {}
		this.tf = {}
		this.dispPth = {} // 设置页"当前实际使用路径"提示用的路径（值为空时显示，不写入配置）
		// 内置默认路径：这 7 项设置的默认值留空；留空时运行时取用这里的路径
		this.defPth = {
			foLfmRev: '%profile%\\yttm\\review\\lastfm\\$lower($cut(%BIO_ALBUMARTIST%,1))',
			foLfmBio: '%profile%\\yttm\\biography\\lastfm\\$lower($cut(%BIO_ARTIST%,1))',
			foWikiRev: '%profile%\\yttm\\review\\wikipedia\\$lower($cut(%BIO_ALBUMARTIST%,1))',
			foWikiBio: '%profile%\\yttm\\biography\\wikipedia\\$lower($cut(%BIO_ARTIST%,1))',
			foImgArt: '%profile%\\yttm\\art_img\\$lower($cut(%BIO_ARTIST%,1))\\%BIO_ARTIST%',
			foImgRev: '%profile%\\yttm\\rev_img\\$lower($cut(%BIO_ALBUMARTIST%,1))\\%BIO_ALBUMARTIST%',
			foLfmSim: '%profile%\\yttm\\lastfm\\$lower($cut(%BIO_ARTIST%,1))'
		};

		this.photoRecycler = `${this.storageFolder}oldPhotosForDeletion\\`;
		this.settingsKeys = [];
		this.writeDefer = 0; // > 0: 变更只留在内存，批次结束时统一写盘一次
		this.writeDirty = false;
		
		this.caPath = `${this.storageFolder}biography-cache`;
		this.cachePath = `${this.caPath}\\`;
		
		this.suffix = {
			foLfmRev: ' [Lastfm Review]',
			foLfmBio: ' [Lastfm Biography]',
			foWikiRev: ' [Wikipedia Review]',
			foWikiBio: ' [Wikipedia Biography]'
		}
	}

	// Methods

	init(settings) {
		// 启动时补齐/迁移的默认值可能有几十项，合并为一次写盘
		this.beginBatch();
		try {
			this.build(settings);
		} finally {
			this.endBatch();
		}
	}

	build(settings) {
		const update = this.checkCfg();
		// migrate old tag settings (0-4 AllMusic removed; shift 5-13 down by 5)
		if (this.cfg.tagEnabled13 !== undefined) {
			for (let j = 0; j < 9; j++) {
				this.cfg[`tagEnabled${j}`] = this.cfg[`tagEnabled${j + 5}`];
				if (j < 8) this.cfg[`tagName${j}`] = this.cfg[`tagName${j + 5}`];
			}
			for (let j = 9; j < 14; j++) delete this.cfg[`tagEnabled${j}`];
			for (let j = 8; j < 13; j++) delete this.cfg[`tagName${j}`];
		}
		this.settingsKeys = settings.map(v => v[3]);
		settings.forEach(v => {
			// this.validate(v); debug
			this.add(v);
		});
		// 迁移（只做一次）：旧版本把内置默认路径存进了 cfg；这些设置现默认留空，
		// 把"恰好等于内置默认"的值清空。加标记避免之后用户再手填同样内容又被清掉。
		if (!this.cfg.pthEmptyMigrated) {
			Object.keys(this.defPth).forEach(v => {
				if (this[v] === this.defPth[v]) this[v] = '';
			});
			this.cfg.pthEmptyMigrated = 1;
			this.writeDirty = true;
		}
		if (update) {
			delete this.cfg.langLfm;
			delete this.cfg.langLfmFallback;
			this.autoCache = 0;
			this.tagName1 = 'Album Statistics Last.fm';
			this.tagName3 = 'Artist Statistics Last.fm';
		}
		this.parse();
	}

	validate(item) {
		if (!$.isArray(item) || item.length !== 4 || typeof item[3] !== 'string') {
			throw ('invalid settings: requires array: [string, any, string, string, string]: ' + item[3]);
		}

		if (item[3] === 'add') {
			throw ('settings_id: ' + item[3] + '\n此 ID 已被保留');
		}

		if (this[item[3]] != null || this[item[3] + '_internal'] != null) {
			throw ('settings_id: ' + item[3] + '\n此 ID 已被占用');
		}

		if (this.key_list[item[3]] != null) {
			throw ('settings_key: ' + item[3] + '\\n此 key 已被占用');
		}
	}

	add(item) {
		// this.key_list[item[3]] = 1; debug
		this[item[3] + '_internal'] = new Setting(item[3], item[1], item[2]);

		Object.defineProperty(this, item[3], {
			get() {
				return this[item[3] + '_internal'].get();
			},
			set(new_value) {
				this[item[3] + '_internal'].set(new_value);
			}
		});
	}

	get(key, default_value, type) { // initialisation
		let saved_value = this.cfg[key];
		switch (type) { // guard check against users directly editing file erroneously
			case 'text':
				if (!saved_value && saved_value != default_value) {
					this.set(key, default_value);
					return default_value;
				}
				break;
			case 'boolean':
				if (saved_value !== true && saved_value !== false) {
					this.set(key, default_value);
					return default_value;
				}
				break;
			case 'num':
				saved_value = parseInt(saved_value);
				if (isNaN(saved_value)) {
					this.set(key, default_value);
					return default_value;
				}
				break;
		}
		return saved_value;
	}

	set(key, new_value) {
		this.cfg[key] = new_value;
		if (this.writeDefer) { // 批次内：只标记，不落盘
			this.writeDirty = true;
			return;
		}
		this.writeCfg();
	}

	// 批量写：begin/end 之间的所有变更（含 parse() 里的夹取修正）只在内存中生效，
	// 结束时整文件写一次，替代原先"每改一个 key 就整文件重写"的做法。
	beginBatch() {
		this.writeDefer++;
	}

	endBatch() {
		if (this.writeDefer > 0) this.writeDefer--;
		if (!this.writeDefer && this.writeDirty) this.writeCfg();
	}

	writeCfg() {
		this.writeDirty = false;
		$.save(this.bio, JSON.stringify($.sortKeys(this.cfg), null, 3), true);
	}

	toggle(name) {
		this[name] = !this[name];
	}

	checkCfg() {
		if (!$.file(this.item_properties)) $.save(this.item_properties, item_properties, true);
		if (!$.file(this.nowplaying)) $.save(this.nowplaying, nowplaying, true);
		if ($.file(this.bio)) return;
		const orig_cfg = `${fb.ProfilePath}yttm\\biography.cfg`;
		if ($.file(orig_cfg)) {
			try {
				fso.CopyFile(orig_cfg, this.bio);
				this.cfg = $.jsonParse(this.bio, {}, 'file-utf8'); // Regorxxx <- Force UTF-8 ->
				const blacklist_image = `${fb.ProfilePath}yttm\\blacklist_image.json`;
				if ($.file(blacklist_image)) {
					fso.CopyFile(blacklist_image, `${cfg.storageFolder}blacklist_image.json`);
				}
				return true;
			} catch (e) {
				this.createCfg(settings);
				return false;
			}
		} else {
			this.createCfg(settings);
			return false;
		}
	}


	createCfg(settings) {
		settings.forEach(v => {
			this.cfg[v[3]] = v[1];
		});
		if (this.cfg.supFo && this.cfg.supFo.includes('>')) {
			const split = this.cfg.supFo.split('>');
			if (split[0].length && split[1].length) {
				this.cfg.supFind = split[0];
				this.cfg.supReplace = split[1];
			}
		}
		$.save(this.bio, JSON.stringify($.sortKeys(this.cfg), null, 3), true);
	}

	getLangIndex(n) {
		if (n) this.language = n;
		this.lang.arr.some((v, i) => {
			if (v.toLowerCase() == this.language.toLowerCase()) {
				this.lang.ix = i;
				return this.lang.ok = true;
			}
		});
	}

	open() {
		const ok_callback = (new_ppt, new_cfg, type, new_dialogWindow) => {
			if (new_dialogWindow) ppt.set('Biography Dialog Box', new_dialogWindow);
			if (new_ppt) ui.updateProp($.jsonParse(new_ppt, {}), 'value');
			if (new_cfg) {
				const lang_ix = this.lang.ix;
				const cache_type = this.autoCache;
				this.updateCfg($.jsonParse(new_cfg, {}));
				if (cache_type != this.autoCache) this.setCacheMode();
				if (lang_ix != this.lang.ix) this.setLanguage(this.lang.ix);
			}
			if (new_ppt || new_cfg) return;
			switch (type) {
				case 'resetPanelCfg':
					ui.updateProp(ppt, 'default_value');
					break;
				case 'resetServerCfg':
					this.resetCfg();
					break;
				case 'empty': {
					try {
						const app = new ActiveXObject('Shell.Application');
						app.NameSpace(10).MoveHere(this.photoRecycler);
					} catch (e) {
						$.trace('无法清空照片回收器：可以使用 Windows 资源管理器清空');
					}
					break;
				}
				case 'open':
					$.browser(this.photoRecycler, false);
					break;
			}
		}
		let dialogWindow = ppt.get('Biography Dialog Box', JSON.stringify({
			w: 85,
			h: 60,
			def_w: 85,
			def_h: 60,
			tab: 'PanelCfg',
			panelPage: 'display',
			serverPage: 'download',
			displaySaveFolders: false,
			version: `v${window.ScriptInfo.Version}`
		}));
		dialogWindow = $.jsonParse(dialogWindow);
		dialogWindow.version = `v${window.ScriptInfo.Version}`;
		dialogWindow = JSON.stringify(dialogWindow);
		if (popUpBox.isHtmlDialogSupported()) popUpBox.config(JSON.stringify(ppt), JSON.stringify(cfg), dialogWindow, ok_callback, this.lang.ix, $.folder(cfg.photoRecycler));
		else {
			popUpBox.ok = false;
			$.trace('在当前操作系统中，html 选项对话框似乎不可用。选项中的所有设置都可以在其它地方找到：1）面板设置在面板属性中；2）适用于所有面板的服务器设置都在 cfg 文件中 - 默认设置对于大多数用户来说应该没问题，但可以通过在文本编辑器中仔细编辑来更改。常用设置位于菜单上。');
		}
	}

	parse() {
		const bioRevItems = ['foLfmRev', 'foLfmBio', 'foImgArt', 'foImgRev', 'foWikiRev', 'foWikiBio'];
		const items = ['foLfmRev', 'foLfmBio', 'foImgArt', 'foLfmSim', 'foWikiRev', 'foWikiBio', 'foImgCov', 'fnImgCov'];
		const tfIni = ['tfAlbumArtist', 'tfArtist', 'tfAlbum', 'tfTitle', 'tfComposition'];
		const tfItems = ['albumArtist', 'artist', 'album', 'title', 'composition'];
		const tfNames = ['%BIO_ALBUMARTIST%', '%BIO_ARTIST%', '%BIO_ALBUM%', '%BIO_TITLE%', '%BIO_COMPOSITION%'];

		tfNames.forEach((v, i) => { // remove self
			this.tf[tfItems[i]] = this[tfIni[i]].replace(RegExp(v, 'gi'), '');
		});

		this.substituteTf = n => {
			tfNames.forEach((v, i) => {
				n = n.replace(RegExp(v, 'gi'), this.tf[tfItems[i]]);
			})
			return n;
		}

		tfItems.forEach(v => this.tf[v] = this.substituteTf(this.tf[v]));

		// 内置默认路径落在"包数据"缓存目录下（原 %profile%\\yttm\\ 前缀换成 biography-cache）
		const cachePth = d => d.replace('%profile%\\yttm\\', $.tfEscape(this.cachePath));
		const dispCachePth = d => d.replace('%profile%\\yttm\\', '%storage_folder%\\biography-cache\\');
		this.dispPth = {};
		items.forEach((v, i) => {
			const def = this.defPth[v]; // 仅 7 项路径类设置存在内置默认；foImgCov/fnImgCov 无
			const auto = this.autoCache && i <= 5 && !!def;
			let base;
			if (!def) base = this[v]; // 自动保存封面：没有内置默认，直接用设置值
			else if (auto) {
				base = cachePth(def);
				this.remap[v] = base;
			} else base = this[v] || cachePth(def); // 留空 -> 内置默认（与"默认"模式同一目录，切换模式不挪数据）
			this.pth[v] = this.substituteTf(base);
		});
		// 设置页提示：7 项路径设置统一按"值为空 -> 默认缓存路径"给出（foImgRev 只用 remap，不在 items 里）
		Object.keys(this.defPth).forEach(v => {
			this.dispPth[v] = this[v] ? this[v] : dispCachePth(this.defPth[v]);
		});

		if (!this.classicalModeEnable) {
			ppt.classicalMusicMode = false;
			ppt.classicalAlbFallback = false;
		}

		this.suffix = {
			foLfmRev: ' [Lastfm Review]',
			foLfmBio: ' [Lastfm Biography]',
			foWikiRev: ' [Wikipedia Review]',
			foWikiBio: ' [Wikipedia Biography]'
		}

		const needRevSuffix = [...new Set([this.pth.foLfmRev, this.pth.foWikiRev])].length != 2;
		if (!needRevSuffix) {
			this.suffix.foLfmRev = this.suffix.foWikiRev = '';
		}

		const needBioSuffix = [...new Set([this.pth.foLfmBio, this.pth.foWikiBio])].length != 2;
		if (!needBioSuffix) {
			this.suffix.foLfmBio = this.suffix.foWikiBio = '';
		}

		this.albCovFolder = this.substituteTf(this.expandPath(this.foCycCov));
		this.artCusImgFolder = this.substituteTf(this.expandPath(this.foCycPhoto));

		this.exp = this.exp > 0 ? Math.max(this.exp, 30) : 0; // 0: 禁止自动更新；否则最小 30 天
		this.getLangIndex();
		if (!this.lang.ok) this.language = 'EN';
		this.menuSimilarNum = $.clamp(this.menuSimilarNum, 0, 10);
		this.lfmSim = this.dlLfmSim;
		if (this.lfmSim && this.menuSimilarNum < 7 && (!this.tagEnabled5 || this.tagEnabled8 < 7)) this.lfmSim = false;
		this.photoNum = $.clamp(this.photoNum, 1, 40);
		this.photoLimit = this.photoLimit ? Math.max(this.photoLimit, this.photoNum, this.photoAutoAdd * 5) : 0;
		
		this.fuzzyMatchReview = $.clamp(this.fuzzyMatchReview, 0, 100);
		this.fuzzyMatchTrack = $.clamp(this.fuzzyMatchTrack, 0, 100);
		this.fuzzyMatchComposition = $.clamp(this.fuzzyMatchComposition, 0, 100);
		this.partialMatch = this.partialMatchEnabled + '-' + this.fuzzyMatchReview + '-' + this.fuzzyMatchTrack + '-' + this.fuzzyMatchComposition;
		this.tagEnabled8 = $.clamp(this.tagEnabled8, 1, 6);
		
		if (this.autoCache) {
			this.remap['foImgRev'] = cachePth(this.defPth['foImgRev']);
		} else {
			bioRevItems.forEach(v => {
				this.remap[v] = this[v] || cachePth(this.defPth[v]); // 留空 -> 内置默认
				if (v.endsWith('Rev')) this.remap[v] = this.remap[v].replace(/%BIO_ALBUMARTIST%|%BIO_ARTIST%/gi, '%BIO_ALBUMARTIST%'); // simplify later substitutions + convert case
				else this.remap[v] = this.remap[v].replace(/%BIO_ARTIST%|%BIO_ALBUMARTIST%/gi, '%BIO_ARTIST%'); // simplify later substitutions + convert case
			});
		}

		if (this.supCache) { // supplemental
			let replace = this.supFind.split('|');
			const arr1 = replace.map(v => v.trim() || 'yttm');
			replace = this.supReplace.split('|');
			const arr2 = replace.map(v => v.trim() || 'yttm\\bio_supplemental');
			bioRevItems.forEach(v => {
				this.sup[v] = this[v] || cachePth(this.defPth[v]); // 留空 -> 内置默认
				if (arr1.length == arr2.length) arr1.forEach((w, j) => {
					this.sup[v] = this.sup[v].replace(RegExp(w, 'gi'), arr2[j]);
				});
				if (v.endsWith('Rev')) this.sup[v] = this.sup[v].replace(/%BIO_ALBUMARTIST%|%BIO_ARTIST%/gi, '%BIO_ALBUMARTIST%');
				else this.sup[v] = this.sup[v].replace(/%BIO_ARTIST%|%BIO_ALBUMARTIST%/gi, '%BIO_ARTIST%');
			});
		}

		const fields = n => n.replace(/\$.*?\(/gi, '').replace(/(,(|\s+)\d+)/gi, '').replace(/[,()[\]%]/gi, '|').split('|');
		this.albartFields = fields(this.tf.albumArtist).filter(v => v.trim());
		this.artFields = fields(this.tf.artist).filter(v => v.trim());
		this.albFields = fields(this.tf.album).filter(v => v.trim());

		if (this.cusCov) { // custom covers
			this.cusCovPaths = [];
			const nm = this.cusCov0;
			if (nm && nm.length) this.cusCovPaths.push(this.substituteTf(this.expandPath(nm)));
		}
	}

	expandPath(pth) {
		if (/%profile%\\/i.test(pth) && /%storage_folder%\\/i.test(pth)) pth = pth.replace(/%profile%\\/gi, '');
		return pth.replace(/^%profile%\\?/i, $.tfEscape(fb.ProfilePath)).replace(/^%storage_folder%\\?/i, $.tfEscape(cfg.storageFolder));
	}

	preview(n, tfAll, excludeStream, sFind, sReplace, artistView, trackReview) {
		if (!tfAll) return txt.tf(n, artistView, trackReview); // heading
		if (excludeStream) {
			const handle = $.handle(panel.id.focus, true);
			if (!handle) return;
			const covCanBeSaved = !handle.RawPath.startsWith('fy+') && !handle.RawPath.startsWith('3dydfy:') && !handle.RawPath.startsWith('http');
			if (!covCanBeSaved) return '流媒体：未保存封面';
		}
		n = this.expandPath(n);
		const tf = tfAll.split('~#~');
		const tfNames = ['%BIO_ALBUMARTIST%', '%BIO_ARTIST%', '%BIO_ALBUM%', '%BIO_TITLE%'];

		if (sFind || sReplace) { // supplemental
			let replace = sFind.split('|');
			const arr1 = replace.map(v => v.trim() || 'yttm');
			replace = sReplace.split('|');
			const arr2 = replace.map(v => v.trim() || 'yttm\\bio_supplemental');
			if (arr1.length == arr2.length) {
				n = this.expandPath(this.dispPth.foLfmBio || this.foLfmBio);
				arr1.forEach((v, i) => n = n.replace(RegExp(v, 'gi'), arr2[i]));
			} else n = 'Invalid find and replace'
			n = n.replace(/%BIO_ARTIST%|%BIO_ALBUMARTIST%/gi, '%BIO_ARTIST%');
		}
		tfNames.forEach((v, i) => n = n.replace(RegExp(v, 'gi'), tf[i]));

		const wildCard = /[*?]/.test(n);
		return !wildCard ? panel.cleanPth(n, false) : panel.cleanPth(n.replace(/\*/g, '@!@').replace(/\?/g, '!@!'), false).replace(/@!@/g, '*').replace(/!@!/g, '?');
	}

	move(n) {
		const d = new Date;
		const timestamp = [d.getFullYear(), $.padNumber((d.getMonth() + 1), 2), $.padNumber(d.getDate(), 2)].join('-') + '_' + [$.padNumber(d.getHours(), 2), $.padNumber(d.getMinutes(), 2), $.padNumber(d.getSeconds(), 2)].join('-');
		try {
			const fn = `${this.storageFolder + this.cfgBaseName}_old_${timestamp}.cfg`;
			if (!$.file(fn)) fso.MoveFile(this.bio, fn);
		} catch (e) {
			if (n) fb.ShowPopupMessage(`无法重置服务器设置。\n\n${this.cfgBaseName}.cfg 正被另一个程序使用。`, '简介');
		}
	}

	resetCfg() {
		cfg.move(true);
		window.Reload();
	}

	setCacheMode() {
		window.Reload();
	}

	setLanguage(i) {
		if (i < this.lang.arr.length) {
			this.lang.ix = i;
			this.language = this.lang.arr[this.lang.ix];
		} else this.toggle('languageFallback');
		txt.bio.subhead = {
			lfm: [this.lfmDisplayName, `${this.lfmDisplayName} ${txt.bio.lang[this.lang.ix]}`],
			wiki: [this.wikiDisplayName, `${this.wikiDisplayName} ${txt.bio.lang[this.lang.ix]}`],
			txt: ['', '']
		}
		txt.rev.subhead = {
			lfm: [this.lfmDisplayName, `${this.lfmDisplayName} ${txt.rev.lang[this.lang.ix]}`],
			wiki: [this.wikiDisplayName, `${this.wikiDisplayName} ${txt.rev.lang[this.lang.ix]}`],
			txt: ['', '']
		}
		txt.artistReset(true);
		txt.albumReset(true);
		txt.albumFlush();
		txt.artistFlush();
		txt.rev.cur = '';
		txt.bio.cur = '';
		
		txt.bio.loaded = {
			lfm: false,
			wiki: false,
			txt: false,
			ix: -1
		}
		txt.rev.loaded = {
			lfm: false,
			wiki: false,
			txt: false,
			ix: -1
		}
		
		txt.loadReader();
		txt.getText(true);
		but.createStars();
		txt.getSubHeadWidths();
		txt.artCalc();
		txt.albCalc();
		server.setLanguage(this.language);
		panel.callServer(2, panel.id.focus, '', 1);
	}

	setTag(i, handles) {
		switch (true) {
			case i && i < 9:
				this.toggle(`tagEnabled${i - 1}`);
				break;
			case i == 9: {
				const cur = $.jsonParse(ppt.get('Biography Dialog Box'), {});
				ppt.set('Biography Dialog Box', JSON.stringify({
					w: cur.w,
					h: cur.h,
					def_w: 85,
					def_h: 60,
					tab: 'ServerCfg',
					panelPage: cur.panelPage,
					serverPage: 'tagger'
				}));
				this.open();
				break;
			}
			case i == 10: {
				if (!this.taggerConfirm) {
					if (this.tagEnabled5 && this.tagEnabled8 < 7) tag.check(handles);
					else tag.write(handles);
					break;
				}
				const continue_confirmation = (status, confirmed) => {
					if (confirmed) {
						if (this.tagEnabled5 && this.tagEnabled8 < 7) tag.check(handles);
						else tag.write(handles);
					}
				}
				const caption = '写入文件标签：';
				const prompt = handles.Count < 2000 ? `更新 ${handles.Count} 首音轨。\n\n继续？` : `更新 ${handles.Count} 首音轨。\n\n提示：此操作会分析大量数据。\n\n继续？`;
				const wsh = popUpBox.isHtmlDialogSupported() ? popUpBox.confirm(caption, prompt, '确定', '取消', '', '', continue_confirmation) : true;
				if (wsh) continue_confirmation('ok', $.wshPopup(prompt, caption));
				break;
			}
		}
		if (i < 9) return;
	}

	updateCfg(new_cfg) {
		this.beginBatch();
		try {
			this.settingsKeys.forEach(v => cfg[v] = this.cfg[v] = new_cfg[v + '_internal'].value);
			tag.setGenres();
			this.parse();
		} finally {
			this.endBatch();
		}
	}
}
const cfg = new Settings('biography');

let settings = [
	['Album Review [Lastfm] Auto-Download', false, 'boolean', 'dlLfmRev'],
	['Biography [Lastfm] Auto-Download', true, 'boolean', 'dlLfmBio'],
	['Album Review [Wikipedia] Auto-Download', false, 'boolean', 'dlWikiRev'],
	['Biography [Wikipedia] Auto-Download', true, 'boolean', 'dlWikiBio'],
	['Image [Artist] Auto-Download', true, 'boolean', 'dlArtImg'],
	['Image [Review] Auto-Download', true, 'boolean', 'dlRevImg'],
	['Save List 0-Never 1-Auto', true, 'boolean', 'dlLfmSim'],

	['%BIO_ALBUMARTIST%', '$if3($meta(album artist,0),$meta(artist,0),$meta(composer,0),$meta(performer,0))', 'text', 'tfAlbumArtist'],
	['%BIO_ARTIST%', '$if3($meta(artist,0),$meta(album artist,0),$meta(composer,0),$meta(performer,0))', 'text', 'tfArtist'],
	['%BIO_ALBUM%', '$meta(album,0)', 'text', 'tfAlbum'],
	['%BIO_TITLE%', '$meta(title,0)', 'text', 'tfTitle'],
	['%BIO_COMPOSITION%', '$if2($meta(work,0),$meta(group,0))', 'text', 'tfComposition'],

	['Classical Music Mode Enable', false, 'boolean', 'classicalModeEnable'],

	['Lastfm & Wikipedia Language', 'ZH', 'text', 'language'],
	['Lastfm & Wikipedia Language Fallback To English', false, 'boolean', 'languageFallback'],
	['Wikipedia English Genres', true, 'boolean', 'wikipediaEnGenres'],

	['Album Review [Lastfm] Folder', '', 'text', 'foLfmRev'],
	['Biography [Lastfm] Folder', '', 'text', 'foLfmBio'],
	['Album Review [Wikipedia] Folder', '', 'text', 'foWikiRev'],
	['Biography [Wikipedia] Folder', '', 'text', 'foWikiBio'],
	['Image [Artist] Folder', '', 'text', 'foImgArt'],
	['Image [Review] Folder', '', 'text', 'foImgRev'],

	['Auto Cache', 1, 'num', 'autoCache'],
	['Save Folder', '', 'text', 'foLfmSim'],

	['Image [Artist] Initial Download Number (1-20)', 5, 'num', 'photoNum'],
	['Image [Artist] Auto-Add New', true, 'boolean', 'photoAutoAdd'],
	['Image [Artist] Cache Limit', 0, 'num', 'photoLimit'],

	['Auto-Save', false, 'boolean',  'dlLfmCov'],
	['Auto-Save Folder', '$directory_path(%path%)', 'text', 'foImgCov'],
	['Auto-Save File Name', 'cover', 'text', 'fnImgCov'],

	['Folder', '%storage_folder%\\biography-cache\\art_img\\$lower($cut(%BIO_ARTIST%,1))\\%BIO_ARTIST%', 'text', 'foCycCov'],
	['Folder', '%storage_folder%\\biography-cache\\art_img\\$lower($cut(%BIO_ARTIST%,1))\\%BIO_ARTIST%', 'text', 'foCycPhoto'],
	['Album Name Auto-Clean', false, 'boolean', 'albStrip'],
	['Auto-Update Interval (days: min 30, 0 disables auto-update)', 0, 'num', 'exp'],

	['Review Image Quality 0-Medium 1-High', false, 'boolean', 'imgRevHQ'],
	['Search: Include Partial Matches', true, 'boolean',  'partialMatchEnabled'],
	['Search: Fuzzy Match Level Review', 80, 'num',  'fuzzyMatchReview'],
	['Search: Fuzzy Match Level Track', 80, 'num',  'fuzzyMatchTrack'],
	['Search: Fuzzy Match Level Composition', 66, 'num',  'fuzzyMatchComposition'],
	['Similar Artists: Number to Display(0-10)', 6, 'num', 'menuSimilarNum'],
	['Various Artists', 'Various Artists', 'text', 'va'],

	['Site Display Name Last.fm', 'Last.fm', 'text', 'lfmDisplayName'],
	['Site Display Name Wikipedia', 'Wikipedia', 'text', 'wikiDisplayName'],

	['Write Tag: Album Genre Last.fm', true, 'boolean', 'tagEnabled0'],
	['Write Tag: Album Statistics Last.fm', false, 'boolean', 'tagEnabled1'],
	['Write Tag: Artist Genre Last.fm', true, 'boolean', 'tagEnabled2'],
	['Write Tag: Artist Statistics Last.fm', false, 'boolean', 'tagEnabled3'],
	['Write Tag: Locale Last.fm', true, 'boolean', 'tagEnabled4'],
	['Write Tag: Similar Artists Last.fm', true, 'boolean', 'tagEnabled5'],
	['Write Tag: Album Genre Wikipedia', true, 'boolean', 'tagEnabled6'],
	['Write Tag: Artist Genre Wikipedia', true, 'boolean', 'tagEnabled7'],
	['Write Tag: Similar Artists Last.fm: Number to Write (0-100)', 5, 'num', 'tagEnabled8'],

	['Tag Name: Album Genre Last.fm', 'Album Genre Last.fm', 'text', 'tagName0'],
	['Tag Name: Album Statistics Last.fm', 'Album Statistics Last.fm', 'text', 'tagName1'],
	['Tag Name: Artist Genre Last.fm', 'Artist Genre Last.fm', 'text', 'tagName2'],
	['Tag Name: Artist Statistics Last.fm', 'Artist Statistics Last.fm', 'text', 'tagName3'],
	['Tag Name: Locale Last.fm', 'Locale Last.fm', 'text', 'tagName4'],
	['Tag Name: Similar Artists Last.fm', 'Similar Artists Last.fm', 'text', 'tagName5'],

	['Tag Name: Album Genre Wikipedia', 'Album Genre Wikipedia', 'text', 'tagName6'],
	['Tag Name: Artist Genre Wikipedia', 'Artist Genre Wikipedia', 'text', 'tagName7'],

	['Tagger Show Confirm PopUp Box', true, 'boolean', 'taggerConfirm'],
	['Tagger Last.fm Genre Use Whitelist', 1, 'num', 'useWhitelist'],
	['Tagger Last.fm Genre Custom Genres', '', 'text', 'customGenres'],
	['Tagger Last.fm Genre Translate', 'alt country>alternative country, canterbury>canterbury scene, chanson francaise>chanson fran\u00e7aise, christmas>christmas music, christmas songs>christmas music, eletronica>electronica, motown soul>motown, musicals>musical, neoclassical>neoclassicism, orchestra>orchestral, popular>pop, prog>progressive, rnb>r&b, rhythm and blues>r&b, rb>r&b, relaxing>relaxation, relax>relaxation, rock & roll>rock and roll, rock n roll>rock and roll, tropicalia>tropic\u00e1lia, xmas>christmas music, ye ye>y\u00e9-y\u00e9', 'text', 'translate'],

	['Image [Cover] Check Custom Paths', false, 'boolean', 'cusCov'],
	['Image [Cover] Custom Path [Full Path Minus Extension]', '', 'text', 'cusCov0'],

	['Use Supplemental Cache', false, 'boolean', 'supCache'],
	['Supplemental Cache [Use Find>Replace on SAVE paths]', 'yttm>yttm\\bio_supplemental', 'text', 'supFo'],
	['Supplemental Cache Find', 'yttm', 'text', 'supFind'],
	['Supplemental Cache Replace', 'yttm\\bio_supplemental', 'text', 'supReplace'],

	['Configuration Width', 67, 'num', 'configWidth'],
	['Configuration Height', 85, 'num', 'configHeight'],
	['Show console messages', true, 'boolean', 'showConsoleMessages']
];

let item_properties =

`{
	"*****帮助*****": [
		"将 show 设置为 false 以隐藏组",
		"可以编辑除常规*、元数据*和其它*之外的所有组，即添加、删除或更改属性（保留属性键）",
		"可以删除或移动所有组",
		"可以添加新组",
		"可以更改组名称，但自动扩展的组名称*除外",
		"如果进行编辑，请保持常规格式。如果无法解析文件，则不会显示项目属性，并且控制台将报告 “项目属性：无效的 JSON”",
		"可以使用在线 JSON 验证器检查完整性并定位错误",
		"保存文件名必须包含用于识别的 item_properties，例如 my_item_properties 可以使用",
		"如果需要，请在末尾调整大写字母列表（|分隔符：全词匹配；适用于自动扩展的名称）"
	],
	"showEmpty": false,
	"元数据": {
		"show": true,
		"properties": [
			{"name": "艺术家", "titleformat": "[$meta(artist)]"},
			{"name": "标题", "titleformat": "[$meta(title)]"},
			{"name": "专辑", "titleformat": "[$meta(album)]"},
			{"name": "日期", "titleformat": "[%date%]"},
			{"name": "流派", "titleformat": "[%genre%]"},
			{"name": "音轨号", "titleformat": "[%tracknumber%]"},
			{"name": "作曲", "titleformat": "[%composer%]"},
			{"name": "表演者", "titleformat": "[%performer%]"},
			{"name": "专辑艺术家", "titleformat": "[$meta(album artist)]"},
			{"name": "合计音轨", "titleformat": "[%totaltracks%]"},
			{"name": "碟片编号", "titleformat": "[$if2($meta(discnumber),$meta(disc))]"},
			{"name": "合计碟片", "titleformat": "[%totaldiscs%]"},
			{"name": "注释", "titleformat": "[%comment%]"}
		]
	},
	"元数据*": {
		"show": false,
		"properties": [
			"此组项目不可配置：项目自动扩展。它只能通过设置为 false 来删除、移动或隐藏。不要更改组名称。",
			"用于替代分组（an alternative grouping）。它将按字母顺序显示所有元数据，而不是默认使用的分组。",
			"要使用，将 show 设置为 true。如果使用，最好将上述元数据，Popularity，Last.fm 和维基百科组的 show 设置为 false。"
		]
	},
	"人气": {
		"show": true,
		"properties": [
			{"name": "艺术家", "titleformat": "[$meta(artist statistics last.fm,5[score])]"},
			{"name": "专辑", "titleformat": "[$meta(album statistics last.fm,5[score])]"},
			{"name": "单曲", "titleformat": "[$meta(track statistics last.fm,5[score])]"}
		]
	},
	"Last.fm": {
		"show": true,
		"properties": [
			{"name": "艺术家流派", "titleformat": "[%artist genre last.fm%]"},
			{"name": "专辑流派", "titleformat": "[%album genre last.fm%]"},
			{"name": "区域", "titleformat": "[%locale last.fm%]"},
			{"name": "相似艺术家", "titleformat": "[%similar artists last.fm%]"}
		]
	},
	"维基百科": {
		"show": true,
		"properties": [
			{"name": "艺术家流派", "titleformat": "[%artist genre wikipedia%]"},
			{"name": "专辑流派", "titleformat": "[%album genre wikipedia%]"}
		]
	},
	"YouTube": {
		"show": true,
		"properties": [
			{"name": "Channel title", "titleformat": "[%fy_channel_title%]"},
			{"name": "Channel url", "titleformat": "[%fy_channel_url%]"},
			{"name": "Description", "titleformat": "[%fy_description%]"},
			{"name": "Like count", "titleformat": "[%fy_like_count%]"},
			{"name": "Dislike count", "titleformat": "[%fy_dislike_count%]"},
			{"name": "Search title", "titleformat": "[%search_title%]"},
			{"name": "Thumbnail url", "titleformat": "[%fy_thumbnail_url%]"},
			{"name": "Title", "titleformat": "[%fy_title%]"},
			{"name": "Upload date", "titleformat": "[%fy_upload_date%]"},
			{"name": "View count", "titleformat": "[%fy_view_count%]"}
		]
	},
	"播放统计信息": {
		"show": true,
		"properties": [
			{"name": "播放次数", "titleformat": "[%play_count%]"},
			{"name": "首次播放", "titleformat": "[%first_played%]"},
			{"name": "最近播放", "titleformat": "[%last_played%]"},
			{"name": "添加时间", "titleformat": "[%added%]"},
			{"name": "等级", "titleformat": "[$if3(%_Autorating%,%rating%,$meta(rating))]"}
		]
	},
	"位置": {
	"show": true,
		"properties": [
			{"name": "文件名", "titleformat": "[%filename_ext%]"},
			{"name": "文件夹名", "titleformat": "[$directory_path(%path%)]"},
			{"name": "文件路径", "titleformat": "[%path%]"},
			{"name": "子曲目索引", "titleformat": "[%subsong%]"},
			{"name": "文件大小", "titleformat": "[%filesize_natural%]"},
			{"name": "修改时间", "titleformat": "[%last_modified%]"},
			{"name": "创建时间", "titleformat": "[%file_created%]"}
		]
	},
	"常规*": {
		"show": true,
		"properties": ["此组项目不可配置：项目自动扩展。它只能通过设置为 false 来删除、移动或隐藏。不要更改组名称。"]
	},
	"播放增益": {
		"show": true,
		"properties": [
			{"name": "音轨增益", "titleformat": "[%replaygain_track_gain%]"},
			{"name": "音轨峰值", "titleformat": "[%replaygain_track_peak%]"},
			{"name": "专辑增益", "titleformat": "[%replaygain_album_gain%]"},
			{"name": "专辑峰值", "titleformat": "[%replaygain_album_peak%]"}
		]
	},
	"其它*": {
		"show": true,
		"properties": ["此组项目不可配置：项目自动扩展。它只能通过设置为 false 来删除、移动或隐藏。不要更改组名称。"]
	},
	"uppercase": "ANV|MB"
}`

let nowplaying = `艺术家: %BIO_ARTIST%$crlf()
$crlf()
标题: %BIO_TITLE%$crlf()
$crlf()
[专辑: %BIO_ALBUM%$crlf()
$crlf()]
$if2(%playback_time%,0:00)[ / %length%]`;

cfg.init(settings);
settings = undefined;
item_properties = undefined;
nowplaying = undefined;
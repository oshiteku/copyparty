/*!
 * baguetteBox.js
 * @author  feimosi
 * @version 1.11.1-mod
 * @url https://github.com/feimosi/baguetteBox.js
 */

window.baguetteBox = (function () {
    'use strict';

    var options = {},
        defaults = {
            captions: true,
            buttons: 'auto',
            noScrollbars: false,
            bodyClass: 'bbox-open',
            titleTag: false,
            async: false,
            preload: 2,
            refocus: true,
            afterShow: null,
            afterHide: null,
            duringHide: null,
            onChange: null,
        },
        overlay, slider, btnPrev, btnNext, btnHelp, btnAnim, btnRotL, btnRotR, btnSel, btnFull, btnVmode, btnClose,
        currentGallery = [],
        currentIndex = 0,
        isOverlayVisible = false,
        touch = {},  // start-pos
        touchFlag = false,  // busy
        scrollCSS = ['', ''],
        scrollTimer = 0,
        re_i = /^[^?]+\.(a?png|avif|bmp|gif|heif|jpe?g|jfif|svg|webp)(\?|$)/i,
        re_v = /^[^?]+\.(webm|mkv|mp4)(\?|$)/i,
        anims = ['slideIn', 'fadeIn', 'none'],
        data = {},  // all galleries
        imagesElements = [],
        documentLastFocus = null,
        isFullscreen = false,
        vmute = false,
        vloop = sread('vmode') == 'L',
        vnext = sread('vmode') == 'C',
        loopA = null,
        loopB = null,
        url_ts = null,
        resume_mp = false;

    var onFSC = function (e) {
        isFullscreen = !!document.fullscreenElement;
    };

    var overlayClickHandler = function (e) {
        if (e.target.id.indexOf('baguette-img') !== -1)
            hideOverlay();
    };

    var touchstartHandler = function (e) {
        touch.count = e.touches.length;
        if (touch.count > 1)
            touch.multitouch = true;

        touch.startX = e.changedTouches[0].pageX;
        touch.startY = e.changedTouches[0].pageY;
    };
    var touchmoveHandler = function (e) {
        if (touchFlag || touch.multitouch)
            return;

        e.preventDefault ? e.preventDefault() : e.returnValue = false;
        var touchEvent = e.touches[0] || e.changedTouches[0];
        if (touchEvent.pageX - touch.startX > 40) {
            touchFlag = true;
            showPreviousImage();
        } else if (touchEvent.pageX - touch.startX < -40) {
            touchFlag = true;
            showNextImage();
        } else if (touch.startY - touchEvent.pageY > 100) {
            hideOverlay();
        }
    };
    var touchendHandler = function (e) {
        touch.count--;
        if (e && e.touches)
            touch.count = e.touches.length;

        if (touch.count <= 0)
            touch.multitouch = false;

        touchFlag = false;
    };
    var contextmenuHandler = function () {
        touchendHandler();
    };

    var overlayWheelHandler = function (e) {
        if (!options.noScrollbars || anymod(e))
            return;

        ev(e);

        var x = e.deltaX,
            y = e.deltaY,
            d = Math.abs(x) > Math.abs(y) ? x : y;

        if (e.deltaMode)
            d *= 10;

        if (Date.now() - scrollTimer < (Math.abs(d) > 20 ? 100 : 300))
            return;

        scrollTimer = Date.now();

        if (d > 0)
            showNextImage();
        else
            showPreviousImage();
    };

    var trapFocusInsideOverlay = function (e) {
        if (overlay.style.display === 'block' && (overlay.contains && !overlay.contains(e.target))) {
            e.stopPropagation();
            btnClose.focus();
        }
    };

    function run(selector, userOptions) {
        buildOverlay();
        removeFromCache(selector);
        return bindImageClickListeners(selector, userOptions);
    }

    function bindImageClickListeners(selector, userOptions) {
        var galleryNodeList = QSA(selector);
        var selectorData = {
            galleries: [],
            nodeList: galleryNodeList
        };
        data[selector] = selectorData;

        [].forEach.call(galleryNodeList, function (galleryElement) {
            var tagsNodeList = [];
            if (galleryElement.tagName === 'A')
                tagsNodeList = [galleryElement];
            else
                tagsNodeList = galleryElement.getElementsByTagName('a');

            tagsNodeList = [].filter.call(tagsNodeList, function (element) {
                if (element.className.indexOf(userOptions && userOptions.ignoreClass) === -1)
                    return re_i.test(element.href) || re_v.test(element.href);
            });
            if (!tagsNodeList.length)
                return;

            var gallery = [];
            [].forEach.call(tagsNodeList, function (imageElement, imageIndex) {
                var imageElementClickHandler = function (e) {
                    if (ctrl(e) || e && e.shiftKey)
                        return true;

                    e.preventDefault ? e.preventDefault() : e.returnValue = false;
                    prepareOverlay(gallery, userOptions);
                    showOverlay(imageIndex);
                };
                var imageItem = {
                    eventHandler: imageElementClickHandler,
                    imageElement: imageElement
                };
                bind(imageElement, 'click', imageElementClickHandler);
                gallery.push(imageItem);
            });
            selectorData.galleries.push(gallery);
        });

        return [selectorData.galleries, options];
    }

    function clearCachedData() {
        for (var selector in data)
            if (data.hasOwnProperty(selector))
                removeFromCache(selector);
    }

    function removeFromCache(selector) {
        if (!data.hasOwnProperty(selector))
            return;

        var galleries = data[selector].galleries;
        [].forEach.call(galleries, function (gallery) {
            [].forEach.call(gallery, function (imageItem) {
                unbind(imageItem.imageElement, 'click', imageItem.eventHandler);
            });

            if (currentGallery === gallery)
                currentGallery = [];
        });

        delete data[selector];
    }

    function buildOverlay() {
        overlay = ebi('bbox-overlay');
        if (!overlay) {
            var ctr = mknod('div');
            ctr.innerHTML = (
                '<div id="bbox-overlay" role="dialog">' +
                '<div id="bbox-slider"></div>' +
                '<button id="bbox-prev" class="bbox-btn" type="button" aria-label="Previous">&lt;</button>' +
                '<button id="bbox-next" class="bbox-btn" type="button" aria-label="Next">&gt;</button>' +
                '<div id="bbox-btns">' +
                '<button id="bbox-help" type="button">?</button>' +
                '<button id="bbox-anim" type="button" tt="a">-</button>' +
                '<button id="bbox-rotl" type="button">↶</button>' +
                '<button id="bbox-rotr" type="button">↷</button>' +
                '<button id="bbox-tsel" type="button">sel</button>' +
                '<button id="bbox-full" type="button">⛶</button>' +
                '<button id="bbox-vmode" type="button" tt="a"></button>' +
                '<button id="bbox-close" type="button" aria-label="Close">X</button>' +
                '</div></div>'
            );
            overlay = ctr.firstChild;
            QS('body').appendChild(overlay);
            tt.att(overlay);
        }
        slider = ebi('bbox-slider');
        btnPrev = ebi('bbox-prev');
        btnNext = ebi('bbox-next');
        btnHelp = ebi('bbox-help');
        btnAnim = ebi('bbox-anim');
        btnRotL = ebi('bbox-rotl');
        btnRotR = ebi('bbox-rotr');
        btnSel = ebi('bbox-tsel');
        btnFull = ebi('bbox-full');
        btnVmode = ebi('bbox-vmode');
        btnClose = ebi('bbox-close');
    }

    function halp() {
        if (ebi('bbox-halp'))
            return;

        var list = [
            ['<b># hotkey</b>', '<b># operation</b>'],
            ['escape', 'close'],
            ['left, J', 'previous file'],
            ['right, L', 'next file'],
            ['home', 'first file'],
            ['end', 'last file'],
            ['R', 'rotate (shift=ccw)'],
            ['F', 'toggle fullscreen'],
            ['S', 'toggle file selection'],
            ['space, P, K', 'video: play / pause'],
            ['U', 'video: seek 10sec back'],
            ['P', 'video: seek 10sec ahead'],
            ['0..9', 'video: seek 0%..90%'],
            ['M', 'video: toggle mute'],
            ['V', 'video: toggle loop'],
            ['C', 'video: toggle auto-next'],
            ['<code>[</code>, <code>]</code>', 'video: loop start / end'],
        ],
            d = mknod('table', 'bbox-halp'),
            html = ['<tbody>'];

        for (var a = 0; a < list.length; a++)
            html.push('<tr><td>' + list[a][0] + '</td><td>' + list[a][1] + '</td></tr>');

        html.push('<tr><td colspan="2">tap middle of img to hide btns</td></tr>');
        html.push('<tr><td colspan="2">tap left/right sides for prev/next</td></tr>');
        d.innerHTML = html.join('\n') + '</tbody>';
        d.onclick = function () {
            overlay.removeChild(d);
        };
        overlay.appendChild(d);
    }

    function keyDownHandler(e) {
        if (modal.busy)
            return;

        if (e.key == '?')
            return halp();

        if (anymod(e, true))
            return;

        var k = (e.code || e.key) + '', v = vid(), pos = -1;

        if (k == "BracketLeft")
            setloop(1);
        else if (k == "BracketRight")
            setloop(2);
        else if (e.shiftKey && k != "KeyR" && k != "R")
            return;
        else if (k == "ArrowLeft" || k == "KeyJ" || k == "Left" || k == "j")
            showPreviousImage();
        else if (k == "ArrowRight" || k == "KeyL" || k == "Right" || k == "l")
            showNextImage();
        else if (k == "Escape" || k == "Esc")
            hideOverlay();
        else if (k == "Home")
            showFirstImage(e);
        else if (k == "End")
            showLastImage(e);
        else if (k == "Space" || k == "KeyP" || k == "KeyK")
            playpause();
        else if (k == "KeyU" || k == "KeyO")
            relseek(k == "KeyU" ? -10 : 10);
        else if (k.indexOf('Digit') === 0 && v)
            v.currentTime = v.duration * parseInt(k.slice(-1)) * 0.1;
        else if (k == "KeyM" && v) {
            v.muted = vmute = !vmute;
            mp_ctl();
        }
        else if (k == "KeyV" && v) {
            vloop = !vloop;
            vnext = vnext && !vloop;
            setVmode();
        }
        else if (k == "KeyC" && v) {
            vnext = !vnext;
            vloop = vloop && !vnext;
            setVmode();
        }
        else if (k == "KeyF")
            tglfull();
        else if (k == "KeyS" || k == "s")
            tglsel();
        else if (k == "KeyR" || k == "r" || k == "R")
            rotn(e.shiftKey ? -1 : 1);
        else if (k == "KeyY")
            dlpic();
    }

    function anim() {
        var i = (anims.indexOf(options.animation) + 1) % anims.length,
            o = options;
        swrite('ganim', anims[i]);
        options = {};
        setOptions(o);
        if (tt.en)
            tt.show.call(this);
    }

    function setVmode() {
        var v = vid();
        ebi('bbox-vmode').style.display = v ? '' : 'none';
        if (!v)
            return;

        var msg = 'When video ends, ', tts = '', lbl;
        if (vloop) {
            lbl = 'Loop';
            msg += 'repeat it';
            tts = '$NHotkey: V';
        }
        else if (vnext) {
            lbl = 'Cont';
            msg += 'continue to next';
            tts = '$NHotkey: C';
        }
        else {
            lbl = 'Stop';
            msg += 'just stop'
        }
        btnVmode.setAttribute('aria-label', msg);
        btnVmode.setAttribute('tt', msg + tts);
        btnVmode.textContent = lbl;
        swrite('vmode', lbl[0]);

        v.loop = vloop
        if (vloop && v.paused)
            v.play();
    }

    function tglVmode() {
        if (vloop) {
            vnext = true;
            vloop = false;
        }
        else if (vnext)
            vnext = false;
        else
            vloop = true;

        setVmode();
        if (tt.en)
            tt.show.call(this);
    }

    function findfile() {
        var thumb = currentGallery[currentIndex].imageElement,
            name = vsplit(thumb.href)[1].split('?')[0],
            files = msel.getall();

        for (var a = 0; a < files.length; a++)
            if (vsplit(files[a].vp)[1] == name)
                return [name, a, files, ebi(files[a].id)];
    }

    function tglfull() {
        try {
            if (isFullscreen)
                document.exitFullscreen();
            else
                (vid() || ebi('bbox-overlay')).requestFullscreen();
        }
        catch (ex) {
            if (IPHONE)
                alert('sorry, apple decided to make this impossible on iphones (should work on ipad tho)');
            else
                alert(ex);
        }
    }

    function tglsel() {
        var o = findfile()[3];
        clmod(o.closest('tr'), 'sel', 't');
        msel.selui();
        selbg();
    }

    function dlpic() {
        var url = addq(findfile()[3].href, 'cache');
        dl_file(url);
    }

    function selbg() {
        var img = vidimg(),
            thumb = currentGallery[currentIndex].imageElement,
            name = vsplit(thumb.href)[1].split('?')[0],
            files = msel.getsel(),
            sel = false;

        for (var a = 0; a < files.length; a++)
            if (vsplit(files[a].vp)[1] == name)
                sel = true;

        ebi('bbox-overlay').style.background = sel ?
            'rgba(153,34,85,0.7)' : '';

        img.style.borderRadius = sel ? '1em' : '';
        btnSel.style.color = sel ? '#fff' : '';
        btnSel.style.background = sel ? '#d48' : '';
        btnSel.style.textShadow = sel ? '1px 1px 0 #b38' : '';
        btnSel.style.boxShadow = sel ? '.15em .15em 0 #502' : '';
    }

    function keyUpHandler(e) {
        if (anymod(e))
            return;

        var k = e.code + '';

        if (k == "Space")
            ev(e);
    }

    var passiveSupp = false;
    try {
        var opts = {
            get passive() {
                passiveSupp = true;
                return false;
            }
        };
        window.addEventListener('test', null, opts);
        window.removeEventListener('test', null, opts);
    }
    catch (ex) {
        passiveSupp = false;
    }
    var passiveEvent = passiveSupp ? { passive: false } : null;
    var nonPassiveEvent = passiveSupp ? { passive: true } : null;

    function bindEvents() {
        bind(document, 'keydown', keyDownHandler);
        bind(document, 'keyup', keyUpHandler);
        bind(document, 'fullscreenchange', onFSC);
        bind(overlay, 'click', overlayClickHandler);
        bind(overlay, 'wheel', overlayWheelHandler);
        bind(btnPrev, 'click', showPreviousImage);
        bind(btnNext, 'click', showNextImage);
        bind(btnClose, 'click', hideOverlay);
        bind(btnVmode, 'click', tglVmode);
        bind(btnHelp, 'click', halp);
        bind(btnAnim, 'click', anim);
        bind(btnRotL, 'click', rotl);
        bind(btnRotR, 'click', rotr);
        bind(btnSel, 'click', tglsel);
        bind(btnFull, 'click', tglfull);
        bind(slider, 'contextmenu', contextmenuHandler);
        bind(overlay, 'touchstart', touchstartHandler, nonPassiveEvent);
        bind(overlay, 'touchmove', touchmoveHandler, passiveEvent);
        bind(overlay, 'touchend', touchendHandler);
        bind(document, 'focus', trapFocusInsideOverlay, true);
    }

    function unbindEvents() {
        unbind(document, 'keydown', keyDownHandler);
        unbind(document, 'keyup', keyUpHandler);
        unbind(document, 'fullscreenchange', onFSC);
        unbind(overlay, 'click', overlayClickHandler);
        unbind(overlay, 'wheel', overlayWheelHandler);
        unbind(btnPrev, 'click', showPreviousImage);
        unbind(btnNext, 'click', showNextImage);
        unbind(btnClose, 'click', hideOverlay);
        unbind(btnVmode, 'click', tglVmode);
        unbind(btnHelp, 'click', halp);
        unbind(btnAnim, 'click', anim);
        unbind(btnRotL, 'click', rotl);
        unbind(btnRotR, 'click', rotr);
        unbind(btnSel, 'click', tglsel);
        unbind(btnFull, 'click', tglfull);
        unbind(slider, 'contextmenu', contextmenuHandler);
        unbind(overlay, 'touchstart', touchstartHandler, nonPassiveEvent);
        unbind(overlay, 'touchmove', touchmoveHandler, passiveEvent);
        unbind(overlay, 'touchend', touchendHandler);
        unbind(document, 'focus', trapFocusInsideOverlay, true);
        timer.rm(rotn);
    }

    function prepareOverlay(gallery, userOptions) {
        if (currentGallery === gallery)
            return;

        currentGallery = gallery;
        setOptions(userOptions);
        slider.innerHTML = '';
        imagesElements.length = 0;

        var imagesFiguresIds = [];
        var imagesCaptionsIds = [];
        for (var i = 0, fullImage; i < gallery.length; i++) {
            fullImage = mknod('div', 'baguette-img-' + i);
            fullImage.className = 'full-image';
            imagesElements.push(fullImage);

            imagesFiguresIds.push('bbox-figure-' + i);
            imagesCaptionsIds.push('bbox-figcaption-' + i);
            slider.appendChild(imagesElements[i]);
        }
        overlay.setAttribute('aria-labelledby', imagesFiguresIds.join(' '));
        overlay.setAttribute('aria-describedby', imagesCaptionsIds.join(' '));
    }

    function setOptions(newOptions) {
        if (!newOptions)
            newOptions = {};

        for (var item in defaults) {
            options[item] = defaults[item];
            if (typeof newOptions[item] !== 'undefined')
                options[item] = newOptions[item];
        }

        var an = options.animation = sread('ganim', anims) || anims[ANIM ? 0 : 2];
        btnAnim.textContent = ['⇄', '⮺', '⚡'][anims.indexOf(an)];
        btnAnim.setAttribute('tt', 'animation: ' + an);

        slider.style.transition = (options.animation === 'fadeIn' ? 'opacity .3s ease' :
            options.animation === 'slideIn' ? '' : 'none');

        if (options.buttons === 'auto' && ('ontouchstart' in window || currentGallery.length === 1))
            options.buttons = false;

        btnPrev.style.display = btnNext.style.display = (options.buttons ? '' : 'none');
    }

    function showOverlay(chosenImageIndex) {
        if (options.noScrollbars) {
            var a = document.documentElement.style.overflowY,
                b = document.body.style.overflowY;

            if (a != 'hidden' || b != 'scroll')
                scrollCSS = [a, b];

            document.documentElement.style.overflowY = 'hidden';
            document.body.style.overflowY = 'scroll';
        }
        if (overlay.style.display === 'block')
            return;

        bindEvents();
        currentIndex = chosenImageIndex;
        touch = {
            count: 0,
            startX: null,
            startY: null
        };
        loadImage(currentIndex, function () {
            preloadNext(currentIndex);
            preloadPrev(currentIndex);
        });

        clmod(ebi('bbox-btns'), 'off');
        clmod(btnPrev, 'off');
        clmod(btnNext, 'off');

        updateOffset();
        overlay.style.display = 'block';
        // Fade in overlay
        setTimeout(function () {
            overlay.className = 'visible';
            if (options.bodyClass && document.body.classList)
                document.body.classList.add(options.bodyClass);

            if (options.afterShow)
                options.afterShow();
        }, 50);

        if (options.onChange && !url_ts)
            options.onChange(currentIndex, imagesElements.length);

        url_ts = null;
        documentLastFocus = document.activeElement;
        btnClose.focus();
        isOverlayVisible = true;
    }

    function hideOverlay(e, dtor) {
        ev(e);
        playvid(false);
        removeFromCache('#files');
        if (options.noScrollbars) {
            document.documentElement.style.overflowY = scrollCSS[0];
            document.body.style.overflowY = scrollCSS[1];
        }

        try {
            if (document.fullscreenElement)
                document.exitFullscreen();
        }
        catch (ex) { }
        isFullscreen = false;

        if (dtor || overlay.style.display === 'none')
            return;

        if (options.duringHide)
            options.duringHide();

        sethash('');
        unbindEvents();

        // Fade out and hide the overlay
        overlay.className = '';
        setTimeout(function () {
            overlay.style.display = 'none';
            if (options.bodyClass && document.body.classList)
                document.body.classList.remove(options.bodyClass);

            qsr('#bbox-halp');

            if (options.afterHide)
                options.afterHide();

            options.refocus && documentLastFocus && documentLastFocus.focus();
            isOverlayVisible = false;
            unvid();
            unfig();
        }, 250);
    }

    function unvid(keep) {
        var vids = QSA('#bbox-overlay video');
        for (var a = vids.length - 1; a >= 0; a--) {
            var v = vids[a];
            if (v == keep)
                continue;

            v.src = '';
            v.load();

            var p = v.parentNode;
            p.removeChild(v);
            p.parentNode.removeChild(p);
        }
    }

    function unfig(keep) {
        var figs = QSA('#bbox-overlay figure'),
            npre = options.preload || 0,
            k = [];

        if (keep === undefined)
            keep = -9;

        for (var a = keep - npre; a <= keep + npre; a++)
            k.push('bbox-figure-' + a);

        for (var a = figs.length - 1; a >= 0; a--) {
            var f = figs[a];
            if (!has(k, f.getAttribute('id')))
                f.parentNode.removeChild(f);
        }
    }

    function loadImage(index, callback) {
        var imageContainer = imagesElements[index];
        var galleryItem = currentGallery[index];

        if (typeof imageContainer === 'undefined' || typeof galleryItem === 'undefined')
            return;  // out-of-bounds or gallery dirty

        if (imageContainer.querySelector('img, video'))
            // was loaded, cb and bail
            return callback ? callback() : null;

        // maybe unloaded video
        while (imageContainer.firstChild)
            imageContainer.removeChild(imageContainer.firstChild);

        var imageElement = galleryItem.imageElement,
            imageSrc = imageElement.href,
            is_vid = re_v.test(imageSrc),
            thumbnailElement = imageElement.querySelector('img, video'),
            imageCaption = typeof options.captions === 'function' ?
                options.captions.call(currentGallery, imageElement) :
                imageElement.getAttribute('data-caption') || imageElement.title;

        imageSrc = addq(imageSrc, 'cache');

        if (is_vid && index != currentIndex)
            return;  // no preload

        var figure = mknod('figure', 'bbox-figure-' + index);
        figure.innerHTML = '<div class="bbox-spinner">' +
            '<div class="bbox-double-bounce1"></div>' +
            '<div class="bbox-double-bounce2"></div>' +
            '</div>';

        if (options.captions && imageCaption) {
            var figcaption = mknod('figcaption', 'bbox-figcaption-' + index);
            figcaption.innerHTML = imageCaption;
            figure.appendChild(figcaption);
        }
        imageContainer.appendChild(figure);

        var image = mknod(is_vid ? 'video' : 'img');
        clmod(imageContainer, 'vid', is_vid);

        image.addEventListener(is_vid ? 'loadedmetadata' : 'load', function () {
            // Remove loader element
            qsr('#baguette-img-' + index + ' .bbox-spinner');
            if (!options.async && callback)
                callback();
        });
        image.setAttribute('src', imageSrc);
        if (is_vid) {
            image.volume = clamp(fcfg_get('vol', dvol / 100), 0, 1);
            image.setAttribute('controls', 'controls');
            image.onended = vidEnd;
            image.onplay = function () { show_buttons(1); };
            image.onpause = function () { show_buttons(); };
        }
        image.alt = thumbnailElement ? thumbnailElement.alt || '' : '';
        if (options.titleTag && imageCaption)
            image.title = imageCaption;

        figure.appendChild(image);

        if (is_vid && window.afilt)
            afilt.apply(undefined, image);

        if (options.async && callback)
            callback();
    }

    function showNextImage(e) {
        ev(e);
        return show(currentIndex + 1);
    }

    function showPreviousImage(e) {
        ev(e);
        return show(currentIndex - 1);
    }

    function showFirstImage(e) {
        if (e)
            e.preventDefault();

        return show(0);
    }

    function showLastImage(e) {
        if (e)
            e.preventDefault();

        return show(currentGallery.length - 1);
    }

    function show(index, gallery) {
        gallery = gallery || currentGallery;
        if (!isOverlayVisible && index >= 0 && index < gallery.length) {
            prepareOverlay(gallery, options);
            showOverlay(index);
            return true;
        }

        if (index < 0)
            return bounceAnimation('left');

        if (index >= imagesElements.length)
            return bounceAnimation('right');

        try {
            vid().pause();
        }
        catch (ex) { }

        currentIndex = index;
        loadImage(currentIndex, function () {
            preloadNext(currentIndex);
            preloadPrev(currentIndex);
        });
        updateOffset();

        if (options.animation == 'none')
            unvid(vid());
        else
            setTimeout(function () {
                unvid(vid());
            }, 100);

        unfig(index);

        if (options.onChange)
            options.onChange(currentIndex, imagesElements.length);

        return true;
    }

    var prev_cw = 0, prev_ch = 0, unrot_timer = null;
    function rotn(n) {
        var el = vidimg(),
            orot = parseInt(el.getAttribute('rot') || 0),
            frot = orot + (n || 0) * 90;

        if (!frot && !orot)
            return;  // reflow noop

        var co = ebi('bbox-overlay'),
            cw = co.clientWidth,
            ch = co.clientHeight;

        if (!n && prev_cw === cw && prev_ch === ch)
            return;  // reflow noop

        prev_cw = cw;
        prev_ch = ch;
        var rot = frot,
            iw = el.naturalWidth || el.videoWidth,
            ih = el.naturalHeight || el.videoHeight,
            magic = 4,  // idk, works in enough browsers
            dl = el.closest('div').querySelector('figcaption a'),
            vw = cw,
            vh = ch - dl.offsetHeight + magic,
            pmag = Math.min(1, Math.min(vw / ih, vh / iw)),
            wmag = Math.min(1, Math.min(vw / iw, vh / ih));

        while (rot < 0) rot += 360;
        while (rot >= 360) rot -= 360;
        var q = rot == 90 || rot == 270 ? 1 : 0,
            mag = q ? pmag : wmag;

        el.style.cssText = 'max-width:none; max-height:none; position:absolute; display:block; margin:0';
        if (!orot) {
            el.style.width = iw * wmag + 'px';
            el.style.height = ih * wmag + 'px';
            el.style.left = (vw - iw * wmag) / 2 + 'px';
            el.style.top = (vh - ih * wmag) / 2 - magic + 'px';
            q = el.offsetHeight;
        }
        el.style.width = iw * mag + 'px';
        el.style.height = ih * mag + 'px';
        el.style.left = (vw - iw * mag) / 2 + 'px';
        el.style.top = (vh - ih * mag) / 2 - magic + 'px';
        el.style.transform = 'rotate(' + frot + 'deg)';
        el.setAttribute('rot', frot);
        timer.add(rotn);
        if (!rot) {
            clearTimeout(unrot_timer);
            unrot_timer = setTimeout(unrot, 300);
        }
    }
    function rotl() {
        rotn(-1);
    }
    function rotr() {
        rotn(1);
    }
    function unrot() {
        var el = vidimg(),
            orot = el.getAttribute('rot'),
            rot = parseInt(orot || 0);

        while (rot < 0) rot += 360;
        while (rot >= 360) rot -= 360;
        if (rot || orot === null)
            return;

        clmod(el, 'nt', 1);
        el.removeAttribute('rot');
        el.removeAttribute("style");
        rot = el.offsetHeight;
        clmod(el, 'nt');
        timer.rm(rotn);
    }

    function vid() {
        if (currentIndex >= imagesElements.length)
            return;

        return imagesElements[currentIndex].querySelector('video');
    }

    function vidimg() {
        if (currentIndex >= imagesElements.length)
            return;

        return imagesElements[currentIndex].querySelector('img, video');
    }

    function playvid(play) {
        if (!play) {
            timer.rm(loopchk);
            loopA = loopB = null;
        }

        var v = vid();
        if (!v)
            return;

        v[play ? 'play' : 'pause']();
        if (play && loopA !== null && v.currentTime < loopA)
            v.currentTime = loopA;
    }

    function playpause() {
        var v = vid();
        if (v)
            v[v.paused ? "play" : "pause"]();
    }

    function relseek(sec) {
        if (vid())
            vid().currentTime += sec;
    }

    function vidEnd() {
        if (this == vid() && vnext)
            showNextImage();
    }

    function setloop(side) {
        var v = vid();
        if (!v)
            return;

        var t = v.currentTime;
        if (side == 1) loopA = t;
        if (side == 2) loopB = t;
        if (side)
            toast.inf(5, 'Loop' + (side == 1 ? 'A' : 'B') + ': ' + f2f(t, 2));

        if (loopB !== null) {
            timer.add(loopchk);
            sethash(location.hash.slice(1).split('&')[0] + '&t=' + (loopA || 0) + '-' + loopB);
        }
    }

    function loopchk() {
        if (loopB === null)
            return;

        var v = vid();
        if (!v || v.paused || v.currentTime < loopB)
            return;

        v.currentTime = loopA || 0;
    }

    function urltime(txt) {
        url_ts = txt;
    }

    function mp_ctl() {
        var v = vid();
        if (!vmute && v && mp.au && !mp.au.paused) {
            mp.fade_out();
            resume_mp = true;
        }
        else if (resume_mp && (vmute || !v) && mp.au && mp.au.paused) {
            mp.fade_in();
            resume_mp = false;
        }
    }

    function show_buttons(v) {
        clmod(ebi('bbox-btns'), 'off', v);
        clmod(btnPrev, 'off', v);
        clmod(btnNext, 'off', v);
    }

    function bounceAnimation(direction) {
        slider.className = options.animation == 'slideIn' ? 'bounce-from-' + direction : 'eog';
        setTimeout(function () {
            slider.className = '';
        }, 300);
        return false;
    }

    function updateOffset() {
        var offset = -currentIndex * 100 + '%',
            xform = slider.style.perspective !== undefined;

        if (options.animation === 'fadeIn') {
            slider.style.opacity = 0;
            setTimeout(function () {
                xform ?
                    slider.style.transform = 'translate3d(' + offset + ',0,0)' :
                    slider.style.left = offset;
                slider.style.opacity = 1;
            }, 100);
        } else {
            xform ?
                slider.style.transform = 'translate3d(' + offset + ',0,0)' :
                slider.style.left = offset;
        }
        playvid(false);
        var v = vid();
        if (v) {
            playvid(true);
            v.muted = vmute;
            v.loop = vloop;
            if (url_ts) {
                var seek = ('' + url_ts).split('-');
                v.currentTime = seek[0];
                if (seek.length > 1) {
                    loopA = parseFloat(seek[0]);
                    loopB = parseFloat(seek[1]);
                    setloop();
                }
            }
        }
        selbg();
        mp_ctl();
        setVmode();

        var el = vidimg();
        if (el.getAttribute('rot'))
            timer.add(rotn);
        else
            timer.rm(rotn);

        var ctime = 0;
        el.onclick = v ? null : function (e) {
            var rc = e.target.getBoundingClientRect(),
                x = e.clientX - rc.left,
                fx = x / (rc.right - rc.left);

            if (fx < 0.3)
                return showPreviousImage();

            if (fx > 0.7)
                return showNextImage();

            show_buttons('t');

            if (Date.now() - ctime <= 500 && !IPHONE)
                tglfull();

            ctime = Date.now();
        };

        var prev = QS('.full-image.vis');
        if (prev)
            clmod(prev, 'vis');

        clmod(el.closest('div'), 'vis', 1);
    }

    function preloadNext(index) {
        if (index - currentIndex >= options.preload)
            return;

        loadImage(index + 1, function () {
            preloadNext(index + 1);
        });
    }

    function preloadPrev(index) {
        if (currentIndex - index >= options.preload)
            return;

        loadImage(index - 1, function () {
            preloadPrev(index - 1);
        });
    }

    function bind(element, event, callback, options) {
        element.addEventListener(event, callback, options);
    }

    function unbind(element, event, callback, options) {
        element.removeEventListener(event, callback, options);
    }

    function destroyPlugin() {
        hideOverlay(undefined, true);
        unbindEvents();
        clearCachedData();
        document.getElementsByTagName('body')[0].removeChild(ebi('bbox-overlay'));
        data = {};
        currentGallery = [];
        currentIndex = 0;
    }

    return {
        run: run,
        show: show,
        showNext: showNextImage,
        showPrevious: showPreviousImage,
        relseek: relseek,
        urltime: urltime,
        playpause: playpause,
        hide: hideOverlay,
        destroy: destroyPlugin
    };
})();

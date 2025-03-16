// Version 2024.9.11.1-tb
(function () {
  var MEDIUM_THRESHOLD = 0.3;
  var HIGH_THRESHOLD = 0.6;

  var cookies = {
    PREFIX: "cookie_",
    VISITOR_ID_COOKIE_NAME: "vs_vid",
    SESSION_ID_COOKIE_NAME: "vs_sid",
    VISITOR_FIRST_SESSION_COOKIE_NAME: "vs_vfs",
    CONVERSION_PROBABILITY_COOKIE_NAME: "vs_conv_ai",
    UPLIFT_PROBABILITY_COOKIE_NAME: "vs_lift_ai",
    PERSISTED_COOKIE_EXPIRATION: 365 * 10,
    ENGAGEMENT_GROUP_COOKIE_NAME: "vs_eg",
    SESSION_RANDOM_NUMBER_COOKIE_NAME: "vs_srn",

    get: function (name) {
      return utils.getParam(document.cookie, name, ";");
    },

    set: function (name, value, options) {
      options = options || {};

      var expires = options.expires;
      if (typeof expires == "number" && expires) {
        var date = new Date();
        date.setDate(date.getDate() + expires);
        expires = options.expires = date;
      }

      if (expires && expires.toUTCString) {
        options.expires = expires.toUTCString();
      }

      if (!options.path) {
        options.path = "/";
      }

      if (!options.domain) {
        options.domain = utils.resolveDomain(window.location.hostname);
      }

      value = encodeURIComponent(value);
      var updatedCookie = name + "=" + value;
      for (var option in options) {
        if (Object.prototype.hasOwnProperty.call(options, option)) {
          updatedCookie += "; " + option;
          var optionValue = options[option];
          if (optionValue !== true) {
            updatedCookie += "=" + optionValue;
          }
        }
      }
      document.cookie = updatedCookie;
    },

    //set cookies parameter if is absent
    setIfAbsent: function (name, value, options) {
      if (cookies.get(name) == null) {
        cookies.set(name, value, options);
      }
    },

    clear: function (name) {
      var domain = utils.resolveDomain(document.location.hostname);
      document.cookie =
        name +
        "=; path=/; " +
        "domain=" +
        domain +
        ";expires=Thu, 01 Jan 1970 00:00:00 UTC";
      document.cookie =
        name + "=; path=/;expires=Thu, 01 Jan 1970 00:00:00 UTC";
    },
  };

  var utils = {
    //get parameters
    getParam: function (source, name, delimiter) {
      var param;
      var params = source.split(delimiter);
      for (var i = 0, length = params.length; i < length; ++i) {
        param = params[i].replace(/^\s+|\s+$/g, "");
        if (param.indexOf(name + "=") == 0) {
          return param.substr(name.length + 1);
        }
      }
      return null;
    },

    //resolve domain
    resolveDomain: function (hostname) {
      if (hostname == "localhost") {
        return "";
      } else {
        var dom_periods = hostname.split(".");
        if (
          dom_periods[dom_periods.length - 1].match(/com|ca|ai|in|io|org|net/g)
        ) {
          return "." + dom_periods.splice(-2).join(".");
        } else {
          return "." + dom_periods.splice(-3).join(".");
        }
      }
    },
  };

  var GLOBAL_VARIABLE = {
    PREFIX: "global_",

    PARAMETERS: ["ml_mwbc1", "ml_mwbc2", "ml_mwbc3", "ml_mwbc4"],
  };

  var logger = (function () {
    var enabled = false;

    return {
      enableLogging: function () {
        enabled = true;
      },
      checkUrlOnLoggingEnabled: function () {
        var url = window.location.href;
        if (url.indexOf("log_enabled=true") != -1) {
          return true;
        } else {
          return false;
        }
      },
      log: function () {
        if (enabled && window.console) {
          console.log("VISITOR SCORING: ", arguments);
        }
      },
      error: function () {
        if (enabled && window.console) {
          console.error("VISITOR SCORING: ", arguments);
        }
      },
    };
  })();

  var requestQueue = (function () {
    var RETRY_INTERVAL = 3000;
    var MAX_RETRIES = 3;

    var _queue = [];
    var _requestActive = false;

    var _processJob = function () {
      if (!_requestActive && _queue.length > 0) {
        var job = _queue.shift();
        job();
      }
    };

    var _enqueue = function (url, body, callback, allowBeacon, metadata) {
      // Wrapper on the provided optional callback, so we can hook in processing state as well
      var callbackWrapper = function (xhr) {
        try {
          if (xhr.status === 200 && callback instanceof Function) {
            callback(xhr);
          } else if ([500, 502, 503].includes(xhr.status)) {
            // Is this our first request?
            if(!metadata.hasOwnProperty("retryAttempts")) {
              metadata.retryAttempts = 0;
            }

            if (metadata.retryAttempts < MAX_RETRIES) {
              metadata.retryAttempts++;
              setTimeout(function () {
                _enqueue(url, body, callback, allowBeacon, metadata);
              }, RETRY_INTERVAL);
            }
          }
        } finally {
          _requestActive = false;
          _processJob();
        }
      };

      // Generic "post to this URL" job template
      // Use sendBeacon if available because fetch/XMLHttpRequest will not run
      // when window is about to be unloaded
      var postFunction = function () {
        if (allowBeacon && "sendBeacon" in window.navigator) {
          navigator.sendBeacon(url, JSON.stringify(body));
        } else {
          var xhr = new (window.ActiveXObject || XMLHttpRequest)(
            "Microsoft.XMLHTTP"
          );
          xhr.onload = function () {
            callbackWrapper(xhr);
          };
          xhr.open("POST", url, true);
          xhr.setRequestHeader("Content-Type", "application/json");
          if(metadata.hasOwnProperty("apiKey")) {
            xhr.setRequestHeader("X-API-Key", metadata.apiKey);
          }
          xhr.send(JSON.stringify(body));
        }
      };

      // Push job and process the first job in the queue
      _queue.push(function () {
        _requestActive = true;
        postFunction();
      });

      _processJob();
    };

    return {
      enqueue: function (url, body, callback, allowBeacon, metadata) {
        return _enqueue(url, body, callback, allowBeacon, metadata);
      },
    };
  })();

  //js for getting scoring
  window.scoring = (function () {
    var middlewareBaseUrl;
    var dataCollector;
    var pageVisible;
    var gaSendScore = false;
    var gaSendVID = false;
    var driftSendScore = false;
    var pageLoadRecalcMode = "FIRST_PAGE_VIEW";
    var pageLoadRecalcDelay = 10000; // 10 seconds
    var timeOnPageHeartbeatEnabled = false;
    var timeOnPageHeartbeatInterval = 180000; // 3 minutes
    var recalcHeartbeatEnabled = false;
    var recalcHeartbeatInterval = 180000; // 3 minutes
    var conversionTrackingEnabled = false;
    var appendScoresToLinks = false;

    var appendScoresToCurrentUrl = "none";

    var conversionTrackingEventWhitelist = "";
    var gaMode = "GTAG";
    var gaIdentifier = "";
    var gaTrackerName = "";
    var apiGatewayEnabled = true;
    var apiKey = "";

    var isFirstPageView = false;
    var timeOnPageHeartbeatIntervalId = 0;
    var recalcHeartbeatIntervalId = 0;

    var salesLoftIntegrationEnabled = false;

    var documentIsVisible = function () {
      // If the browser is sufficiently old, then document.visibilityState
      // will be undefined. By checking if the value is not hidden, we will default
      // to the document always being visible for these old browsers.
      return document.visibilityState !== "hidden";
    };

    var timer = (function () {
      var _totalTime;
      var _startDate;

      return {
        init: function () {
          _totalTime = 0;
          _startDate = pageVisible ? new Date() : null;
        },

        getTime: function () {
          var calculatedTime = _totalTime;

          if (_startDate) {
            // calculate the total time, which is the previous
            // slices + the new slice.
            calculatedTime += new Date() - _startDate;
          }

          return calculatedTime / 1000;
        },

        stop: function () {
          if (_startDate) {
            _totalTime += new Date() - _startDate;
            _startDate = null;
          }
        },

        start: function () {
          if (!_startDate) {
            _startDate = new Date();
          }
        },
      };
    })();

    //gets url parameter value
    function getParamValue(name) {
      return (
        decodeURIComponent(
          (new RegExp("[?|&]" + name + "=" + "([^&;]+?)(&|#|;|$)", "i").exec(
            location.search
          ) || [null, ""])[1].replace(/\+/g, "%20")
        ) || null
      );
    }

    //gets cookies
    function getCookies() {
      var result = {};
      document.cookie.split(/;\s*/).forEach(function (part) {
        var cookie = part.split("=");
        result[cookies.PREFIX + cookie[0]] = encodeURIComponent(cookie[1]);
      });
      return result;
    }

    //checks value is primitive
    function isPrimitive(value) {
      return (
        typeof value == "string" ||
        typeof value == "number" ||
        typeof value == "boolean"
      );
    }

    //gets global variable value
    function getGlobalVariableValue(name) {
      var value = "";
      try {
        value = eval(name);
      } catch (e) {
        value = "";
      }
      return isPrimitive(value) ? encodeURIComponent(value) : "";
    }

    //gets global variables
    function getGlobalVariables() {
      var result = {};
      var variables = GLOBAL_VARIABLE.PARAMETERS;
      for (var key in variables) {
        if (Object.prototype.hasOwnProperty.call(variables, key)) {
          var name = variables[key];
          result[GLOBAL_VARIABLE.PREFIX + name] = getGlobalVariableValue(name);
        }
      }
      return result;
    }

    //gets url parameters
    function getUrlParameters(query) {
      var result = {};
      query.split("&").forEach(function (part) {
        var item = part.split("=");
        result[item[0]] = decodeURIComponent(item[1]);
      });
      return result;
    }

    function updateScores(jsonResponse, isInitialScoringResponse) {
      updateCookies(
        jsonResponse.visitorId,
        jsonResponse.sessionId,
        jsonResponse.conversionProbability,
        jsonResponse.upliftProbability
      );

      dataCollector = jsonResponse;
      if (appendScoresToLinks) {
        window.scoring.tracking.appendScoresToLinksIn(document, "a");
      }

      var shouldUpdateUrl = (appendScoresToCurrentUrl === "INITIAL_SCORE_ONLY" && isInitialScoringResponse) || (appendScoresToCurrentUrl === "ALWAYS");
      if (shouldUpdateUrl) {
        window.scoring.tracking.appendScoresToCurrentUrl();
      }
    }

    //update visitor parameters in cookies
    function updateCookies(
      visitorId,
      sessionId,
      conversionProbability,
      upliftProbability
    ) {
      if (cookies.get(cookies.VISITOR_ID_COOKIE_NAME) == null) {
        cookies.set(cookies.VISITOR_ID_COOKIE_NAME, visitorId, {
          expires: cookies.PERSISTED_COOKIE_EXPIRATION,
        });
        // cookie which said that this is first session (visitor type eq NEW)
        cookies.set(cookies.VISITOR_FIRST_SESSION_COOKIE_NAME, "1");
      }

      cookies.setIfAbsent(cookies.SESSION_ID_COOKIE_NAME, sessionId);
      cookies.set(
        cookies.CONVERSION_PROBABILITY_COOKIE_NAME,
        convertProbabilityToRange(conversionProbability)
      );
      cookies.set(
        cookies.UPLIFT_PROBABILITY_COOKIE_NAME,
        convertProbabilityToRange(upliftProbability)
      );
    }

    //Returns range of probability as String calculated from gotten probability value.
    //Step of definition is 0.05(from 0 to 1).
    function convertProbabilityToRange(probability) {
      if (typeof probability != "number" || probability < 0.05) {
        return "0-4";
      }
      if (probability >= 0.95) {
        return "95-100";
      }

      //translate probability to percent.
      var probabilityInPercent = probability * 100;

      //tens of digits.
      var divValue = Math.floor(probabilityInPercent / 10);

      //units of digit.
      var modValue = probabilityInPercent % 10;

      //calculate probability lower range limit.
      var lowerRangeLimit = modValue >= 5 ? divValue * 10 + 5 : divValue * 10;

      //returns probability string representation in percent according to gotten probability, e.g. 0.03 => "0-4"
      return lowerRangeLimit + "-" + (lowerRangeLimit + 4);
    }

    function getClientId() {
      try {
        var tracker = ga.getAll()[0];
      } catch (e) {}
      if (tracker !== undefined) {
        return tracker.get("clientId");
      } else {
        try {
          var name = "_ga";
          var matches = document.cookie.match(
            new RegExp(
              "(?:^|; )" +
                name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, "\\$1") +
                "=([^;]*)"
            )
          );
          var cidLong = matches ? decodeURIComponent(matches[1]) : undefined;
          var tmp = cidLong.split(".");
          var cid = tmp[2] + "." + tmp[3];
          if ((cid !== null) | (cid !== undefined) | (cid !== "")) {
            return cid;
          } else {
            logger.error("Can't get clientId.");
          }
        } catch (e) {}
      }
    }

    //get page viewId
    function getViewId() {
      var url = document.getElementById("vs_snippet_script_id").src;
      return getUrlParameters(url.split("?")[1])["viewId"];
    }

    //creates POST request with sessionId, pageViewId, timeSpent
    function sendPostRequest(url, body, callback, allowBeacon) {
      var metadata = {};
      if(apiGatewayEnabled) {
        metadata.apiKey = apiKey;
      }

      requestQueue.enqueue(url, body, callback, allowBeacon, metadata);
    }

    var sendHeartbeat = function (callback, urlParams) {
      var url = middlewareBaseUrl + "/time-on-page";

      if(urlParams) {
        url = url += urlParams;
      }

      var body = {
        visitorId: dataCollector.visitorId,
        sessionId: dataCollector.sessionId,
        pageViewId: dataCollector.pageViewId,
        timeSpent: timer.getTime(),
        viewId: getViewId(),
      };

      // collect visitor data into datacollector object-variable from json response
      var callbackFunction = function (xhr) {
        var status = xhr.status;
        if(status === 200) {
          var jsonResponse = JSON.parse(xhr.response);
          updateScores(jsonResponse, false);
        }

        if (callback) callback();
      };

      sendPostRequest(url, body, callbackFunction);
    };

    function sendRecalculationRequest(eventName, timeSpentOnEvent) {
      var url = middlewareBaseUrl + "/visitor-scoring/recalculate";

      var body = {
        visitorId: dataCollector.visitorId,
        sessionId: dataCollector.sessionId,
        pageViewId: dataCollector.pageViewId,
        timeSpent: timer.getTime(),
        viewId: getViewId(),
        eventName: eventName,
        timeSpentOnEvent: timeSpentOnEvent
      };

      // collect visitor data into datacollector object-variable from json response
      var callbackFunction  = function(xhr) {
        var jsonResponse = JSON.parse(xhr.response);
        updateCookies(jsonResponse.visitorId, jsonResponse.sessionId,
                      jsonResponse.conversionProbability, jsonResponse.upliftProbability);
        dataCollector = jsonResponse;
      };
      sendPostRequest(url, body, callbackFunction);
    }

    var sendTimeOnPage = function () {
      var url = middlewareBaseUrl + "/time-on-page?apiKey="+apiKey;

      var body = {
        sessionId: dataCollector.sessionId,
        visitorId: dataCollector.visitorId,
        pageViewId: dataCollector.pageViewId,
        timeSpent: timer.getTime(),
        viewId: getViewId(),
      };

      if (salesLoftIntegrationEnabled) {
        var companyDetails = JSON.parse(localStorage.getItem("_6senseCompanyDetails"));

        if (companyDetails != null && companyDetails.company != null) {
          body.domain = companyDetails.company.domain;
        }
      }

      sendPostRequest(url, body, function () {}, true);
    };

    var onPageVisibilityChange = function () {
      pageVisible = documentIsVisible();

      if (pageVisible) {
        timer.start();
      } else {
        timer.stop();
      }
    };

    //create event window.onBeforeUnload before page'll be closed after user close the page
    function addEventListeners() {
      window.onbeforeunload = function () {
        if (timeOnPageHeartbeatIntervalId) {
          clearInterval(timeOnPageHeartbeatIntervalId);
        }

        if (recalcHeartbeatIntervalId) {
          clearInterval(recalcHeartbeatIntervalId);
        }

        sendTimeOnPage();
      };

      document.addEventListener("visibilitychange", onPageVisibilityChange);

      if (conversionTrackingEnabled) {
        window.scoring.tracking.addConversionListeners();
      }
    }

    //creates POST request with visitor parameters
    function sendRequestToGetPrediction() {
      try {
        // build segment request
        var url = middlewareBaseUrl + "/visitor-scoring";
        var visitorParameters = getVisitorParameters();

        // collect visitor data into datacollector object-variable from json response
        var callbackFunction = function (xhr) {
          var jsonResponse = JSON.parse(xhr.response);
          updateScores(jsonResponse, true);

          var recalcCallback = function () {
            if (timeOnPageHeartbeatEnabled) {
              timeOnPageHeartbeatIntervalId = setInterval(function () {
                if (documentIsVisible()) {
                  sendHeartbeat(null, "?pageViewComplete=false");
                }
              }, timeOnPageHeartbeatInterval);
            }

            if (recalcHeartbeatEnabled) {
              recalcHeartbeatIntervalId = setInterval(function () {
                if (documentIsVisible()) {
                  sendHeartbeat(null, "?recalculate=true&pageViewComplete=false");
                }
              }, recalcHeartbeatInterval);
            }
          };

          var shouldRecalculate = (pageLoadRecalcMode === "FIRST_PAGE_VIEW" && isFirstPageView) || (pageLoadRecalcMode === "ALWAYS");
          if(shouldRecalculate) {
            // If initial page view recalculation is requested, perform it. Note that we must delay heartbeats
            // on the page until the initial recalculation request is complete!
            setTimeout(function () { sendHeartbeat(recalcCallback, "?recalculate=true&pageViewComplete=false");}, pageLoadRecalcDelay);
          } else {
            // If there are no page view recalculation requests, then manually start the heartbeats, as needed.
            recalcCallback();
          }

          // as soon as we receive these results, send to google analytics
          if (gaSendScore || gaSendVID) {
            sendEventToGA();
          }

          if (driftSendScore) {
            sendEventToDrift();
          }
        };

        sendPostRequest(url, visitorParameters, callbackFunction);
      } catch (e) {
        /* the endpoint is not available, do nothing */
      }
    }

    function convertScoreLabel(score, minimal) {
      var scoreBand = "Low Intent";
      if (score > MEDIUM_THRESHOLD) {
        scoreBand = "Medium Intent";
      }
      if (score > HIGH_THRESHOLD) {
        scoreBand = "High Intent";
      }
      if(minimal) {
        scoreBand = scoreBand[0].toLowerCase();
      }
      return scoreBand;
    }

    function sendEventToGA() {
      var i;
      try {
        if (!dataCollector) {
          logger.log("sendEventToGA: data collector disabled");
          return;
        }

        // Construct the requested analytics events
        var events = [];
        if (gaSendScore) {
          var scoreRange = convertProbabilityToRange(
            dataCollector.conversionProbability
          );
          var scoreLabel = convertScoreLabel(
            dataCollector.conversionProbability
          );

          events.push({
            eventCategory: "Lift AI Score",
            eventLabel: scoreRange,
            eventAction: scoreLabel,
          });
        }

        if (gaSendVID) {
          events.push({
            eventCategory: "Lift AI VID",
            eventAction: dataCollector.visitorId,
          });
        }

        var event;
        // Send the analytics events
        if (typeof gtag !== "undefined" && gaMode === "GTAG") {
          // Send GA scores with gtag
          for (i = 0; i < events.length; i++) {
            event = events[i];

            var fields = {
              event_category: event.eventCategory,
              non_interaction: true,
            };

            if (event.eventLabel) {
              fields.event_label = event.eventLabel;
            }

            if (gaIdentifier) {
              fields.send_to = gaIdentifier;
            }

            gtag("event", event.eventAction, fields);
          }
        } else if (
          typeof ga !== "undefined" &&
          (gaMode === "GA" || gaMode === "GA_CREATE_CUSTOM")
        ) {
          // Send GA scores with analytics.js
          var gaFunctionName = !gaTrackerName
            ? "send"
            : gaTrackerName + ".send";
          for (i = 0; i < events.length; i++) {
            event = events[i];

            ga(gaFunctionName, {
              hitType: "event",
              eventCategory: event.eventCategory,
              eventAction: event.eventAction,
              eventLabel: event.eventLabel,
              nonInteraction: true,
            });
          }
        } else {
          logger.log(
            "sendEventToGA: Google Analytics not configured for this client"
          );
        }
      } catch (e) {
        logger.log("sendEventToGA: Google Analytics integration failed!");
      }
    }


    var driftRetriesLeft = 30;
    function sendEventToDrift() {
      if (!dataCollector) {
        logger.log("sendEventToDrift: data collector disabled");
        return;
      }

      var visitorId = dataCollector.visitorId;
      var scoreRange = convertProbabilityToRange(
        dataCollector.conversionProbability
      );
      var scoreLabel = convertScoreLabel(dataCollector.conversionProbability);

      var sendDataToDrift = function (visitorId, scoreRange) {
        drift.on("ready", function () {
          drift.api.setUserAttributes({
            "Lift AI VID": visitorId,
            "Lift AI Score": scoreRange,
            "Lift AI Intent Segment": scoreLabel,
          });
        });
      };

      if (typeof drift === "undefined") {
        driftRetriesLeft -= 1;
        if (driftRetriesLeft >= 0) {
          setTimeout(function () {
            sendEventToDrift();
          }, 1000);
        }
      } else {
        sendDataToDrift(visitorId, scoreRange);
      }
    }

    function checkGAParametersExistThenSendRequest() {
      if ("undefined" !== typeof getCookies()["cookie__ga"]) {
        sendRequestToGetPrediction();
      } else {
        setTimeout(sendRequestToGetPrediction, 500);
      }
    }

    //creates visitor parameters
    function getVisitorParameters() {
      return {
        referrer: encodeURIComponent(document.referrer),
        interactionType: getParamValue("interaction_type"),
        customerId: getParamValue("customerId"),
        pageName: encodeURIComponent(window.location.pathname.split("/").pop()),
        pageTitle: encodeURIComponent(document.title),
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        timezoneOffset: new Date().getTimezoneOffset(),
        deploymentParameters: {
          url: document.location.href,
          urlParameters: getUrlParameters(location.search.substr(1)),
          cookies: getCookies(),
          globalVariables: getGlobalVariables(),
        },
        clientId: getClientId(),
        viewId: getViewId(),
      };
    }

    var CONVERSION_TRACKING_EVENTS = {
      click: {},
      focus: {},
      blur: {},
      error: {},
      submit: {},
      scroll: {
        enhance: function(event) {
          return { scrollY: window.scrollY, scrollX: window.scrollX };
        },
        debounceMs: 1000,
      },
      visibilitychange: {
        enhance: function(event) {
          return { state: document.visibilityState };
        },
      },
    };

    var EVENT_TEXT_CHARACTER_LIMIT = 100;

    function extractCommonData(event) {
      var data = {
        event: "browser",
        eventType: event.type,
      };

      if(event.target.tagName) data.targetType = event.target.tagName;
      if(event.target.name) data.targetName = event.target.name;
      if(event.target.id) data.targetId = event.target.id;
      if(event.target.className) data.targetCssClass = event.target.className;

      if(event.target !== document && event.target !== document.body && event.target.textContent)
        data.targetText = event.target.textContent.trim().slice(0, EVENT_TEXT_CHARACTER_LIMIT);

      if(event.target.href) data.targetHref = event.target.href;

      if(event.target.src) data.targetSrc = event.target.href;
      return data;
    }

    function handleGlobalEvent(event, sendBeacon) {
      var eventMeta = CONVERSION_TRACKING_EVENTS[event.type];
      function handle() {
        try {
          logger.log("Received event", event);
          var data = extractCommonData(event);
          var beacon = sendBeacon || false;
          if(eventMeta.enhance) {
            Object.assign(data, eventMeta.enhance(event));
          }

          window.scoring.tracking.pageEvents(data, beacon);
        } catch(e) {
          logger.error("Failed to handle event", e, event);
        } finally {
          eventMeta.debouncedTimeoutId = null;
        }
      }

      var timeoutMs = undefined;
      if(eventMeta.debounceMs) {
        if(eventMeta.debouncedTimeoutId) {

          return;
        }
        timeoutMs = eventMeta.debounceMs;
      }
      var timeoutId = setTimeout(handle, timeoutMs);
      if(eventMeta.debounceMs) {
        eventMeta.debouncedTimeoutId = timeoutId;
      }
    }

    function getUrlScoreParams () {
      if(!dataCollector) {
        return;
      }

      var scoreRange = convertProbabilityToRange(
        dataCollector.conversionProbability
      );
      var scoreLabel = convertScoreLabel(
        dataCollector.conversionProbability, true
      );
      return {
        // lai_vid: dataCollector.visitorId
        // lai_s:  dataCollector.conversionProbability,
        lai_sr: scoreRange,
        lai_sl: scoreLabel,
      };
    }



    function appendScores(linkElements) {
      var queryStringScoreData = getUrlScoreParams();
      if(!queryStringScoreData) {
        return;
      }
      
      logger.log("Appending scores to " + linkElements.length + " links");
      for (var i = 0; i < linkElements.length; i++) {
        var link = linkElements[i];
        var href = link.getAttribute("href");
        if (href) {
          var url = new URL(href, window.location.href);


          if(url && url.hostname === window.location.hostname) {
            for (var key in queryStringScoreData) {
              url.searchParams.set(key, queryStringScoreData[key]);
            }
            link.setAttribute("href", url.href);
          }
        }
      }
    }

    var LINK_NEEDS_URL_PARAMS_SELECTOR = "a:not([href*='lai_s'])";

    return {
      tracking: {
        pageEvents: function (customData, sendBeacon) {
          logger.log("Tracking data", customData, sendBeacon);
          sendBeacon = sendBeacon || false;

          var url = middlewareBaseUrl + "/tracking-event";
          var eventTrackingData = {
            customData: JSON.stringify(customData),
            visitorParameters: getVisitorParameters(),
            pageViewId: dataCollector.pageViewId,
          };

          // If it's a beacon, send it immediately - we are submitting a form
          if (sendBeacon && "sendBeacon" in window.navigator) {
            navigator.sendBeacon(url, JSON.stringify(eventTrackingData));
          } else {
            sendPostRequest(url, eventTrackingData, null, sendBeacon);
          }
        },

        addConversionListeners: function () {
          logger.log("Conversion tracking enabled");
          var enabledEventTypes = Object.keys(CONVERSION_TRACKING_EVENTS);
          try {

            if(conversionTrackingEventWhitelist) {

              var whitelist = conversionTrackingEventWhitelist.trim().split(",").map(function(eventType) {
                return eventType.trim();
              });

              if(whitelist.length > 0) {

                enabledEventTypes = enabledEventTypes.filter(function(eventType) {
                  return whitelist.includes(eventType);
                });
              }
            }
          } catch(e) {
            logger.error("Failed to filter event types", e);
          }
          logger.log("Handling the following events:", enabledEventTypes);
          enabledEventTypes.forEach(function(eventType) {
            document.addEventListener(eventType, handleGlobalEvent);
          }); 


          var forms = document.querySelectorAll("form");
          forms.forEach(function(form) {
            form.addEventListener("submit", function handleFormSubmit(event) {
              handleGlobalEvent(event, true);
            }, false);
          });
        },
        appendScoresToCurrentUrl: function() {
          var queryStringScoreData = getUrlScoreParams();
          if(queryStringScoreData) {
            var url = new URL(window.location.href);
            for (var key in queryStringScoreData) {
              url.searchParams.set(key, queryStringScoreData[key]);
            }
            window.history.replaceState({}, "", url.href);
          }
        },
        appendScoresToLinksIn: function (targetElement, querySelector) {
          // Grab all of the links on the page by default, filter if needed
          // for mutations
          var links = targetElement.querySelectorAll(querySelector);
          appendScores(links);
        },
        initAppendScoresToLinks: function() {
          window.scoring.tracking.appendScoresToLinksIn(document, "a");

          var observer = new MutationObserver(function(mutations) {
            logger.log("MutationObserver fired", mutations.length, mutations);

            mutations.forEach(function(mutation) {




              var target = mutation.target;
              if(mutation.type === "childList") {
                setTimeout(function() {
                  window.scoring.tracking.appendScoresToLinksIn(target, LINK_NEEDS_URL_PARAMS_SELECTOR);
                });
              }

              // Find new links without LAI parameters and add our scores.
              if(mutation.type === "attributes" && mutation.attributeName === "href" &&
                 mutation.target.matches(LINK_NEEDS_URL_PARAMS_SELECTOR)) {
                  setTimeout(function() {
                    appendScores([mutation.target]);
                  });
              }  
            });
          });

          observer.observe(document, {
            // look for and remove nodes anywhere in the document (type = childList)
            childList: true,
            subtree: true,
            // look for nodes that have their href attribute changed (type = attributes)
            attributeFilter: ["href"],
          });
          
          logger.log("Setting up mutation observer for href attributes and added nodes");
        }
      },

      init: function (baseUrl, configParams) {
        if (!configParams) {
          configParams = {};
        }

        // If specified, we need to create the tracker.
        var trackerName = configParams.gaTrackerName;

        // If we are in GA Custom mode, we need to create the tracker and it always needs a proper
        // non-default name. This only works if we also have the identifier as well.
        if (
          configParams.gaMode === "GA_CREATE_CUSTOM" &&
          configParams.gaIdentifier &&
          ga !== "undefined"
        ) {
          trackerName = trackerName ? trackerName : "mlGATracker";
          ga("create", configParams.gaIdentifier, "auto", trackerName, {
            transport: "beacon",
          });
        }

        configParams.hasOwnProperty("apiGatewayEnabled") && (apiGatewayEnabled = configParams.apiGatewayEnabled);
        configParams.apiKey && (apiKey = configParams.apiKey);
        configParams.gaSendScore && (gaSendScore = true);
        configParams.gaSendVID && (gaSendVID = true);
        configParams.driftSendScore && (driftSendScore = true);
        configParams.pageLoadRecalcMode && (pageLoadRecalcMode = configParams.pageLoadRecalcMode);
        configParams.pageLoadRecalcDelay && (pageLoadRecalcDelay = configParams.pageLoadRecalcDelay);
        configParams.timeOnPageHeartbeatEnabled && (timeOnPageHeartbeatEnabled = true);
        configParams.timeOnPageHeartbeatInterval && (timeOnPageHeartbeatInterval = configParams.timeOnPageHeartbeatInterval);
        configParams.recalcHeartbeatEnabled && (recalcHeartbeatEnabled = true);
        configParams.recalcHeartbeatInterval && (recalcHeartbeatInterval = configParams.recalcHeartbeatInterval);
        configParams.gaMode && (gaMode = configParams.gaMode);
        configParams.gaIdentifier && (gaIdentifier = configParams.gaIdentifier);
        configParams.conversionTrackingEnabled && (conversionTrackingEnabled = true);
        configParams.conversionTrackingEventWhitelist && (conversionTrackingEventWhitelist = configParams.conversionTrackingEventWhitelist);
        configParams.appendScoresToLinks && (appendScoresToLinks = true);
        configParams.appendScoresToCurrentUrl && (appendScoresToCurrentUrl = configParams.appendScoresToCurrentUrl);
        configParams.salesLoftIntegrationEnabled && (salesLoftIntegrationEnabled = true)
        trackerName && (gaTrackerName = trackerName);

        middlewareBaseUrl = baseUrl;
        pageVisible = documentIsVisible();
        timer.init();
        addEventListeners();
        if (appendScoresToLinks) {
          window.scoring.tracking.initAppendScoresToLinks();
        }
      },

      start: function () {
        if (logger.checkUrlOnLoggingEnabled()) {
          logger.enableLogging();
        }

        if (cookies.get(cookies.VISITOR_ID_COOKIE_NAME) == null) {
          isFirstPageView = true;
        }

        checkGAParametersExistThenSendRequest();
      },

      sendRecalculationRequest: function (eventName, timeSpentOnEvent) {
        return sendRecalculationRequest(eventName, timeSpentOnEvent);
      },
    };
  })();

  // main init script method
  function loadVSScript() {
    var script = document.getElementById("vs_snippet_script_id");

    var vsmBaseApiUrl = "https://visitor-scoring-new.marketlinc.com"
    window.scoring.init(vsmBaseApiUrl, {
      apiGatewayEnabled: false,
      gaSendScore: false,
      gaSendVID: false,
      gaMode: "GTAG",
      gaIdentifier: "",
      gaTrackerName: "",
      apiKey: "",
      driftSendScore: false,
      pageLoadRecalcMode: "FIRST_PAGE_VIEW",
      pageLoadRecalcDelay: 10000,
      timeOnPageHeartbeatEnabled: false,
      timeOnPageHeartbeatInterval: 180000,
      recalcHeartbeatEnabled: false,
      recalcHeartbeatInterval: 180000,
      conversionTrackingEnabled: false,
      appendScoresToLinks: false,
      appendScoresToCurrentUrl: "",
      conversionTrackingEventWhitelist: "",
      salesLoftIntegrationEnabled: false,
    });

    window.scoring.start();
  }

  try {
    //run main init script method
    var autoload = true;
    
    if (autoload) loadVSScript();
  } catch (e) {
    /* snippet not found, do nothing */
  }
})();
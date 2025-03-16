var client_view_id="62108688";
function loadLiftAI(){
    var c=document.createElement("script");
    c.type="text/javascript";
    c.src="https://lift-ai-js.marketlinc.com/elastic.co/snippet.js?viewId\x3d"+client_view_id;
    c.id="vs_snippet_script_id";document.getElementsByTagName("head")[0].appendChild(c)
}
try{
    loadLiftAI()
} catch(c){}
var ML_getCookie=function(e){for(var t=e+"=",i=decodeURIComponent(document.cookie).split(";"),o=0;o<i.length;o++){for(var n=i[o];" "==n.charAt(0);)n=n.substring(1);if(0==n.indexOf(t))return n.substring(t.length,n.length)}return""}
var ML_setCookie=function(e,t,i){var o=new Date;o.setTime(o.getTime()+864e5*i);var n="expires="+o.toUTCString();document.cookie=e+"="+t+";domain=.elastic.co;"+n+";path=/"};

/*
 * 
 * Apr 09 2024 - enabled for all intent visitors
 * Jun 11 2024 - Removed 6sense code
 * Nov 05 2024 - Added 6sense for all intent PROSERV-5478
 * Nov 21 2024 - Disabled 6sense for all intents PROSERV-5478
 */



function ml_scoring_band(){
	var ml_vs_band = "";
	var ml_score = ML_getCookie('vs_conv_ai')
	var ml_score_int = parseInt(ml_score.split('-')[1]); 
	if(ml_score_int>60){
		ml_vs_band = "High"
	} else if(ml_score_int>30 && ml_score_int<=60){
		ml_vs_band = "Mid"
	} else{
		ml_vs_band = "Low"
	}
	ML_setCookie("vs_intent", ml_vs_band);
	return {
        "ml_vs_band":ml_vs_band,
        "ml_score_range":ml_score
    };
}


/*
 * 6sense Plugin
 *
 */
var ml_visitor_score = ML_getCookie("vs_conv_ai")
    ml_visitor_score = (ml_visitor_score != "")?parseInt(ml_visitor_score.split("-")[0]):0;


var ml_vs_score = ML_getCookie('vs_conv_ai');
if(ml_vs_score != ""){
    var ml_score_intent = ml_scoring_band()
    ML_setCookie("vs_intent", ml_score_intent.ml_vs_band);
    sessionStorage.setItem("ml_old_score",ml_vs_score)
}else if(ml_vs_score == ""){
    var ml_scoring_load_count = 0;
    var ml_scoring_load_interval = setInterval(function(){
        if(ML_getCookie("vs_conv_ai")!="" || ml_scoring_load_count >=8){
            ml_vs_score = ML_getCookie('vs_conv_ai');
            clearInterval(ml_scoring_load_interval);
            var ml_score_intent = ml_scoring_band();
            ML_setCookie("vs_intent", ml_score_intent.ml_vs_band);
            sessionStorage.setItem("ml_old_score",ml_score_intent.ml_score)
        }
        ml_scoring_load_count++;    
    }, 1000);
}

var ml_check_cookie_update_count = 0
var ml_check_cookie_update_Interval = setInterval(function(){
    try{
        // console.log("10seconds")
        var ml_old_score = sessionStorage.getItem("ml_old_score")
        if((ml_old_score != '' && (ml_old_score!=ML_getCookie("vs_conv_ai")))){
            clearInterval(ml_check_cookie_update_Interval);
            var ml_vs_score_new_intent = ml_score_intent()
            ML_setCookie("vs_intent", ml_vs_score_new_intent.ml_vs_band);
            sessionStorage.setItem("ml_old_score",ml_vs_score_new_intent.ml_score_range);
            if(typeof(window.dataLayer) != 'undefined'){
                dataLayer.push({"event":"Lift_AI_Score_Updated"})
            }
        } else if(ml_check_cookie_update_count > 6){
            clearInterval(ml_check_cookie_update_Interval);
        }
        ml_check_cookie_update_count++;

    }catch(e){
        //Do nothing
    }
},2500);

var ml_6si_sent = (ML_getCookie("ml_6si") == "")?0:1
var ml_drift_load_count = 0;
function ml_drift_trackEvents(){
    if(("drift" in window && "scoring" in window) || ml_drift_load_count > 30){ // TESTING to see if we minimize DRIFT-NOT-FOUND further @date: Nov 16 2023
        // clearInterval(ml_drift_load_Interval)
        try{

            /*
             * 6sense Ojbect.
             */
            setTimeout(function(){
                try {
                    var _6sCompanyDetails =  JSON.parse(localStorage.getItem("_6senseCompanyDetails"))
                    if(_6sCompanyDetails != null){
                        if(typeof(_6sCompanyDetails.company) != "undefined" && typeof(_6sCompanyDetails.company) != "undefined" && _6sCompanyDetails.company.name != ""){
                            if(ML_getCookie("ml_6si_sent") == ""){
                                try {
                                    scoring.tracking.pageEvents({
                                        '6s_company': localStorage.getItem("_6senseCompanyDetails")
                                    });
                                    ML_setCookie("ml_6si_sent", "sent",400);
                                }catch(e){
                                    //..nothing
                                }
                            }
                        }
                    }
                } catch (error) {
                    //Nothing
                }
            },3000);


            if(typeof(window.drift) != 'undefined'){
                drift.on('ready', function() {
                    var ml_data = ml_scoring_band();
                    drift.api.setUserAttributes({
                        'Lift AI Intent Segment' : ml_data.ml_vs_band,
                        'Lift AI Score': ml_data.ml_score_range,
                        'Lift AI VID'	:	ML_getCookie('vs_vid')		
                    })
                });
                //Drift capture enabled Oct 24 2023
                drift.on('ready',function(api, payload) {
                    if(typeof(payload.data) != "undefined" && typeof(payload.data.widgetVisible) != "undefined"){
                        window.scoring.tracking.pageEvents({
                            "event": "DRIFT_CHAT_OFFERED",
                            "d_vid" : ML_getCookie("driftt_aid")
                        });
                    }
                });
    
                drift.on("conversation:playbookFired", function(data) {
                    // console.log("Playbook fired: " + JSON.stringify(data))
                    window.scoring.tracking.pageEvents({
                        "event": "DRIFT_PLAYBOOK_FIRED",
                        "d_campaign"	: data.campaignId,
                        "d_playbook"	: data.playbookId,
                        "d_cid"		: data.conversationId,
                        "d_vid" : ML_getCookie("driftt_aid")
                    }) ;
    
                });
    
                drift.on("conversation:playbookClicked", function(data) {
                    // console.log("Playbook fired: " + JSON.stringify(data))
                    window.scoring.tracking.pageEvents({
                        "event": "DRIFT_PLAYBOOK_CLICKED",
                        "d_campaign"	: data.campaignId,
                        "d_playbook"	: data.playbookId,
                        "d_cid"		: data.conversationId,
                        "d_vid" : ML_getCookie("driftt_aid")
                    }) ;
                });
    
                
                /*
                *  Email Submit Capture
                *  
                */
    
                window.drift.on("emailCapture", function(data) {
                    window.scoring.tracking.pageEvents({
                        "event": "DRIFT_EMAIL_CAPTURED"
                    }) ;
                });
                
                /*
                *  Conversation Start
                *  @Captures start of a conversation along with conversation id
                */
    
    
                window.drift.on('startConversation', function (event) {
                    // console.log("startConversation")
                    window.scoring.tracking.pageEvents({
                        "event": "DRIFT_CHAT_STARTED",
                        "d_cid": JSON.stringify(event.conversationId),
                        "d_vid" : ML_getCookie("driftt_aid")
                    }) ;
    
                });
    
                /*
                *      Meeting Booked
                */
    
                window.drift.on("scheduling:meetingBooked", function(data) {
                    // console.log("scheduling:meetingBooked")
                    // console.log("user booked a meeting with " + data.teamMember.name);
                    window.scoring.tracking.pageEvents({
                        "event": "DRIFT_MEETING_BOOKED"
                    }) ;
                });
    
                /*
                *      Phone captured in chat
                */
                window.drift.on("phoneCapture", function(data) {
                    // console.log("User provided a phone number: " + JSON.stringify(data))
                    window.scoring.tracking.pageEvents({
                        "event": "DRIFT_PHONE_NUMBER_CAPTURED"
                    }) ;
                });


                function ml_addEventTracking(selector, eventName) {
					var element = document.querySelector(selector);
					if (element !== null) {
					  element.addEventListener("click", function () {
						window.scoring.tracking.pageEvents({ "event": eventName });
					  });
					}
				  }

                var ml_url = document.location.href;
                // if (ml_url.indexOf('/contact') !== -1) {
                //     window.scoring.tracking.pageEvents({
                //       "event": "Contact Us"
                //     });
                // }

                // if (ml_url.indexOf('/registration ') !== -1 || ml_url.indexOf('/deployments/create') !== -1) {
                //     window.scoring.tracking.pageEvents({
                //       "event": "Trial Sign Up"
                //     });
                // }


                ml_addEventTracking("#elastic-nav nav.jsx-1131868366.nav-actions > ul > li:nth-child(4) > a", "Trial_Signup");
                ml_addEventTracking("#__next nav.jsx-1131868366.nav-actions > ul > li:nth-child(4) > a", "Trial_Signup");
                ml_addEventTracking("#main-content section.footer-cta a", "Trial_Signup");

                ml_addEventTracking("#main-content section.hero div.jsx-4208517559.cta-list > div:nth-child(1) > a", "Trial_Signup");
                ml_addEventTracking("#main-content section.hero div.jsx-1314878840.cta-list > div:nth-child(1) > a", "Trial_Signup");
                ml_addEventTracking("#main-content section.hero div.jsx-4183160068.cta-list a", "Trial_Signup");
                ml_addEventTracking("#main-content section.hero div.jsx-394836568.cta-list a", "Trial_Signup");


                ml_addEventTracking("#main-content section.container div:nth-child(1) div.jsx-636418709.feature-card-wrapper a","Trial_Signup");
                ml_addEventTracking("#main-content section.container div:nth-child(2) div.jsx-636418709.feature-card-wrapper a","Trial_Signup");
                ml_addEventTracking("#main-content section.container div:nth-child(3) div.jsx-636418709.feature-card-wrapper a","Trial_Signup");
                ml_addEventTracking("#main-content section.container div:nth-child(4) div.jsx-636418709.feature-card-wrapper a","Trial_Signup");
                
                //Contact Us Forms
                ml_addEventTracking("#mktoForm_20694 [type='submit']", "Contact_Us");
                ml_addEventTracking("#mktoForm_20605 [type='submit']", "Contact_Us");

                //Webinar_Request
                ml_addEventTracking("#mktoForm_12485 [type='submit']", "Webinar_Request");



    
            } else{
                window.scoring.tracking.pageEvents({
                    "event": "DRIFT_FUNCTION_NOT_FOUND"
                }) ;
            }
        }catch(e){
            // DO NOTHING
        }
    } else{
        ml_drift_load_count++;
        setTimeout(ml_drift_trackEvents,2000);
    }
}
	
ml_drift_trackEvents();


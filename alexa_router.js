const lambda_helper  = require(__dirname + "/helpers/lambda_helper");

// The Alexa router will take a look at the intent to figure out what it needs to
// to do with it. To keep things common wether it's Lex or Alexa it will just require
// the file it needs to and pass along the environment variables.
exports.handler = (event, context, callback) => {
    var intent = null;

    switch(event.request.intent.name) {
        case "EngagementsByPeople":
            intent = require(__dirname + "/engagements_by_people");
            break;        
        case "DealsInStage":
            intent = require(__dirname + "/deals_in_stage");
            break;
        case "TotalInDeals":
            intent = require(__dirname + "/total_in_deals");
            break;
    }

    // If the intent was not found send back a failure.
    if(intent !== null) {
        intent.handler(event, context, callback);
    } else {
        lambda_helper.processCallback(callback, event, "Failed", "I am sorry but we could not process the request.");
    }
};
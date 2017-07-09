/**
 * Intent:
 *   CreateEngagementFor
 *
 * Slot Types:
 * 	engagement_type : {NOTE, EMAIL, TASK, MEETING, or CALL}
 *  sales_slot :      {null, andrew, andy, john}
 *  timeframe :       {today, yesterday, this week, last week, this month, last month, this year} | Defaults to today
 *
 * Commands:
 *   How many {engagements} have been made?
 *   How many {engagements} were made {timeframe}?
 *   How many {enagagments} did {sales} make {timeframe}?
 *
 * Notes:
 */

const config         = require(__dirname + "/config/config.json");
const hubspot_helper = require(__dirname + "/helpers/hubspot_helper");
const lambda_helper  = require(__dirname + "/helpers/lambda_helper");
const misc_helper    = require(__dirname + "/helpers/misc_helper");

exports.handler = (event, context, callback) => {
    console.log(event);
    console.log("beginning check", event.sessionAttributes)
    var slots        = lambda_helper.parseSlots(event);
    var sessionAttributes = event.sessionAttributes || {};

    var owner_id = null;



    var engagement_data = {
        "engagement": {
            "active": true,
            "ownerId": null,
            "type": null,
            "timestamp": Date.now()
        },
        "associations": {
            "contactIds": [selected_contact_id],
            "companyIds": [ ],
            "dealIds": [ ],
            "ownerIds": [ ]
        },
        "attachments": [],
        "metadata": {
            "body": null
        }
    }

    // Required post information.
    // https://developers.hubspot.com/docs/methods/engagements/create_engagement

    /*
     * Engagements
     */
    var engagement_type = false;

    if(slots.engagements.value === null) {
        return lambda_helper.processValidation(callback, event, "engagements", "What type of engagements would you like to get? I have email, note, task, meeting, or call available.");
    }

    config.engagements.forEach((engagement) => {
        slots.engagements.value = misc_helper.format_engagement(slots.engagements.value);

        if(slots.engagements.value.includes(engagement.name) === true) {
            engagement_type = true;
        }
    });

    if(engagement_type === false) {
        return lambda_helper.processValidation(callback, event, "engagements", "I did not understand that engagement. I have email, note, task, meeting, or call available.");
    }

    engagement_type = slots.engagements.value;

    /*
     * Sales Person
     */
    var sales_person = false;

    if(slots.sales.value === null) {
        return lambda_helper.processValidation(callback, event, "sales", "What team member does this relate to?");
    }

    config.sales_people.forEach((person) => {
        if(slots.sales.value.includes(person.first) === true || slots.sales.value.includes(person.last) === true) {
            sales_person = parseInt(person.ownerId);
        }
    });

    if(sales_person === false) {
        return lambda_helper.processValidation(callback, event, "sales", "I did not find that team member. Who is the first sales person you want to compare?");
    }

    /*
     * Contact
     */
    var contact_slot            = slots.contacts.value;
    var contact_confirmation    = slots.contact_confirmation.value;
    if(contact_slot === null) {
        // Lex didnt recognize the slot name
        return lambda_helper.processValidation(callback, event, "contacts", "What contact does this relate to?");

    } else if(contact_confirmation === "yes") {
        // The user selected the last result
        var confirmation_counter = parseInt(event.sessionAttributes.confirmation_count) - 1;
        var contact_list         = JSON.parse(event.sessionAttributes.contact)
        var selected_contact     = contact_list[confirmation_counter]
        var selected_contact_id  = selected_contact.contact_id

        if (sessionAttributes.engagement_step > 0) {
            console.log(sessionAttributes.engagement_step, "greater than 0")
        } else {
            sessionAttributes.engagement_step = 0
            event.sessionAttributes = sessionAttributes
        }
        console.log(`${selected_contact_id} Contact has been confirmed!`)

    // User denied the last contact we showed them.     
    } else if(contact_confirmation === "no") {
        var contact_list         = JSON.parse(event.sessionAttributes.contact)     
        var confirmation_counter = parseInt(event.sessionAttributes.confirmation_count);
        
        // Make sure there is still more contacts to cycle through.
        if(contact_list.length - 1 < confirmation_counter) {
            console.log(`No more possible matches for ${contact_slot}`)
            return lambda_helper.processCallback(callback, event, "Fulfilled", `No more possible matches for ${contact_slot}`)
        };

        console.log("contact_list", contact_list)
        var full_name = `${contact_list[confirmation_counter].first_name} ${contact_list[confirmation_counter].last_name}`
        var job_title = `${contact_list[confirmation_counter].job_title}`        

        // Cycle to next available contact.
        ++confirmation_counter
        
        // Reset sessionAttributes to send to lex.
        sessionAttributes.confirmation_count = confirmation_counter
        sessionAttributes.contact = JSON.stringify(contact_list)
        event.sessionAttributes = sessionAttributes

        console.log(`Is ${full_name}, ${job_title}, who you are looking for? (yes, no)`)
        return lambda_helper.processValidation(callback, event, "contact_confirmation", `Is ${full_name}, ${job_title}, who you are looking for? (yes, no)`)

    // We haven't supplied the user with a contact to confirm yet.
    } else if(contact_confirmation === null) {
        // Define the properties we want back from hubspot
        // which ultimately improves the speed of the API call.
        var hubspot_properties = [
           'associatedcompanyid',
           'jobtitle',
           'firstname',
           'lastname'
        ]
        hubspot_properties = '&property=' + hubspot_properties.join('&property=')

        // Create the request into hubspot using the helper.
        // Contacts search -> https://developers.hubspot.com/docs/methods/contacts/search_contacts
        hubspot_helper.createRequest(`/contacts/v1/search/query?q=${contact_slot}${hubspot_properties}`, "GET", null).then((body) => {
            var content         = "";
            var contact_list    = [];

            // Loop through each of the contacts for potentially multiple matches.
            body.forEach((data) => {
                data.contacts.forEach((result) => {
                    var contact           = {}
                    contact.contact_id    = "vid" in result ? result.vid : null;
                    contact.assoc_comp_id = "associatedcompanyid" in result.properties ? result.properties.associatedcompanyid.value : null
                    contact.first_name    = "firstname" in result.properties ? result.properties.firstname.value : null;
                    contact.last_name     = "lastname" in result.properties ? result.properties.lastname.value : null;
                    contact.job_title     = "jobtitle" in result.properties ? result.properties.jobtitle.value : null;
                    contact.full_name     = `${contact.first_name} ${contact.last_name}`;
                    contact_list.push(contact);
                });
            });

            if(contact_list.length === 0) {
                // Hubspot Search returned 0 results.
                return lambda_helper.processCallback(callback, event, "Failed", `${contact_slot} doesn't appear to be a contact within hubspot.`);
            }

            // Contact attributes. 
            var full_name = `${contact_list[0].first_name} ${contact_list[0].last_name}`
            var job_title = `${contact_list[0].job_title}`

            // Account for the first name being sent back.
            confirmation_counter = 1

            // Set session attributes for lex.
            sessionAttributes.confirmation_count = confirmation_counter
            sessionAttributes.contact = JSON.stringify(contact_list)
            event.sessionAttributes = sessionAttributes

            console.log("ending check", event.sessionAttributes)
            console.log("confirmation_count", confirmation_counter)
            return lambda_helper.processValidation(callback, event, "contact_confirmation", `Is ${full_name}, ${job_title}... who you are looking for? (yes, no)`)

        }).catch((err) => {
            console.log(err.message)
            return lambda_helper.processCallback(callback, event, "Failed", err.message);
        });
    }

    /*
     * Engagement Meta Data
     */
    
    // Build Object to post.
    engagement_data.engagement.ownerId = sales_person
    engagement_data.engagement.type = engagement_type
    engagement_data.associations.contactIds = [selected_contact_id]

    if(contact_confirmation === 'yes' && (slots.meta_confirmation.value === null || slots.meta_confirmation.value !== 'yes' || slots.meta_confirmation.value !== 'no')) {
        console.log('confirmed null meta')
        if(slots.engagements.value === 'CALL') {            
            // Call step 1
            if(parseInt(sessionAttributes.engagement_step) === 0) {
                console.log('Meta Event', event)
                sessionAttributes.engagement_step = 1
                event.sessionAttributes = sessionAttributes
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `What was the outcome of this call?`);
            // Call step 2
            } else if (parseInt(sessionAttributes.engagement_step) === 1) {
                console.log(event.inputTranscript)
                engagement_data.metadata.status = event.inputTranscript 
                sessionAttributes.engagement_data = JSON.stringify(engagement_data)
                sessionAttributes.engagement_step = 2
                event.sessionAttributes = sessionAttributes                
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `Great any notes on this call?`);
            // Call step 3
            } else if (parseInt(sessionAttributes.engagement_step) === 2) {
                //Add meta data to engagement object.
                engagement_data = JSON.parse(sessionAttributes.engagement_data)
                engagement_data.metadata.body = event.inputTranscript
                sessionAttributes.engagement_data = JSON.stringify(engagement_data)
                event.sessionAttributes = sessionAttributes 
                console.log('Meta Event', event)
                console.log('engagement_data', engagement_data)

                //Make Hubspot Post
                //
                hubspot_helper.createRequest(`/engagements/v1/engagements/`, "POST", engagement_data).then((body) => {
                    console.log(body)
                    return lambda_helper.processValidation(callback, event, "meta_confirmation", 
                        `Are you ready for me to log a call that took place between you and ${selected_contact_id} with
                        a status of ${engagement_data.metadata.status} and the following notes: ${engagement_data.metadata.body} (yes,) 
                    `);
                }).catch((err) => {
                    console.log(err.message)
                    return lambda_helper.processCallback(callback, event, "Failed", err.message);
                });                
            }            
        } else if(slots.engagements.value === 'EMAIL') {
            // Email step 1
            if(parseInt(sessionAttributes.engagement_step) === 0) {
                console.log('Meta Event', event)
                sessionAttributes.engagement_step = 1
                event.sessionAttributes = sessionAttributes
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `Copy and Paste the email to me`);
            // Email step 2
            } else if (parseInt(sessionAttributes.engagement_step) === 1) {
                //Add meta data to engagement object. 
                engagement_data.metadata.body = event.inputTranscript 
                sessionAttributes.engagement_data = JSON.stringify(engagement_data)
                event.sessionAttributes = sessionAttributes                
                console.log('Meta Event', event)
                console.log('engagement_data', engagement_data)

                //Make Hubspot Post
                //
                return lambda_helper.processValidation(callback, event, "meta_confirmation", 
                    `Are you ready for me to log a email that took place between you and ${selected_contact_id} with
                    a status of ${engagement_data.metadata.status} and the following notes: ${engagement_data.metadata.body} (yes,) 
                `);
            // Email step 3
            }
        } else if(slots.engagements.value === 'MEETING') {
            // Meeting step 1
            if(parseInt(sessionAttributes.engagement_step) === 0) {
                console.log('Meta Event', event)
                sessionAttributes.engagement_step = 1
                event.sessionAttributes = sessionAttributes
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `What was the outcome of this call?`);
            // Meeting step 2
            } else if (parseInt(sessionAttributes.engagement_step) === 1) {
                console.log(event.inputTranscript)
                engagement_data.metadata.status = event.inputTranscript 
                sessionAttributes.engagement_data = JSON.stringify(engagement_data)
                sessionAttributes.engagement_step = 2
                event.sessionAttributes = sessionAttributes                
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `Great any notes on this call?`);
            // Meeting step 3
            } else if (parseInt(sessionAttributes.engagement_step) === 2) {
                //Add meta data to engagement object.
                engagement_data = JSON.parse(sessionAttributes.engagement_data)
                engagement_data.metadata.body = event.inputTranscript
                sessionAttributes.engagement_data = JSON.stringify(engagement_data)
                event.sessionAttributes = sessionAttributes 
                console.log('Meta Event', event)
                console.log('engagement_data', engagement_data)

                //Make Hubspot Post
                //
                return lambda_helper.processValidation(callback, event, "meta_confirmation", 
                    `Are you ready for me to log a meeting that took place between you and ${selected_contact_id} with
                    a status of ${engagement_data.metadata.status} and the following notes: ${engagement_data.metadata.body} (yes,) 
                `);
            }             
        }
        else if(slots.engagements.value === 'TASK') {
            if(slots.body.value === null) {
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `What would`);
            }            
        }
        else if(slots.engagements.value === 'NOTE') {
            if(slots.body.value === null) {
                return lambda_helper.processValidation(callback, event, "meta_confirmation", `What would`);
            }            
        }                                
    }

};
function funcOnLoad() {
    console.log('bot selection page')
    connect();
}

const gTokenExpireId = "SchwabTokenExpiredAt";
var signal_socket = null;
function connect() {
    signal_socket = new WebSocket(`${window.WS_HEADER}//${window.location.host}/ws/signalpath/`);

    signal_socket.onopen = function(event) {
        console.log("Connected to WebSocket");
    };
    
    signal_socket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log(data)

        if (data.msg_title == 'user_auth_state') {
            var msg_body  = JSON.parse(data.msg_body)
            console.log(msg_body)
            const expire_sec = msg_body['expire_sec']
    
            let eleAuthStatus = document.getElementById('lblAuthStatus')
            if (expire_sec <= 0) {
                eleAuthStatus.innerHTML = `Auth Status: Auth is not performed or Expired`;
                eleAuthStatus.style.color = "red";
                funcDeleteCookie(gTokenExpireId);
            }
            else {
                let now = new Date();
                now.addSecs(expire_sec);
                const formattedDate = now.toLocaleString('en-US', {
                    month: 'long',   // "May" (full month name)
                    day: '2-digit',  // "05" (zero-padded)
                    year: 'numeric', // "2025"
                    hour: '2-digit', // "06" (12-hour format by default)
                    minute: '2-digit', // "34"
                    hour12: false    // Use 24-hour format (optional)
                });
                eleAuthStatus.innerHTML = `Auth Status: Expire At local time ${formattedDate}`;
                //eleAuthStatus.innerHTML = `Auth Status: Expire at ${now.toISOString()}`;

                eleAuthStatus.style.color = "green";
                funcSetCookieByExpireInSecs(gTokenExpireId, now.toISOString(), expire_sec);
            }
        }
        else if (data.msg_title == "user_missing_message") {
            const msg_arr = JSON.parse(data.msg_body)
            console.log(msg_arr)
            const msg_n = msg_arr.length
            console.log(msg_n)
            var missing_msg = ""
            for (var i = 0; i < msg_n; i++) {
                const msg_ele = msg_arr[i]
                const bot_name = msg_ele.bot_name
                const order_status = msg_ele.order_status
                missing_msg += `${i+1}. Placed an order by ${bot_name} with status ${order_status}\n`
            }
            alert(missing_msg)
        }
        else if (data.msg_title == "bot1_order_result") {
            const msg_body = data.msg_body
            const order_status = msg_body.order_status
            alert("Placed an order by Bot1 with status: " + order_status)
        }
        else if (data.msg_title == "bot2_order_result") {
            const msg_body = data.msg_body
            const order_status = msg_body.order_status
            alert("Placed an order by Bot2 with status: " + order_status)
        }
    };
    
    signal_socket.onclose = function(e) {
        signal_socket = null;  
        console.log('Socket closed.'); 
        console.log('Socket is closed. Reconnect will be attempted in 1 second.', e.reason);
        setTimeout(function() {
          connect();
        }, 10000);        
    }
    
    signal_socket.onerror = function(err) {
        console.error(err);
        signal_socket.close();
    };
}




async function onAuthenBtnClick() {
    var endPoint = `${window.SERVER_ENDPOINT}/schwab_authenticate/`
    window.location.href = endPoint;
}














function funcSetCookieByExpireInDays(cname, cvalue, exdays) {
    const d = new Date();
    d.setTime(d.getTime() + (exdays*24*60*60*1000));
    let expires = "expires="+ d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function funcSetCookieByExpireInMins(cname, cvalue, exmins) {
    const d = new Date();
    d.setTime(d.getTime() + (exmins*60*1000));
    let expires = "expires="+ d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
} 
function funcSetCookieByExpireInSecs(cname, cvalue, exsecs) {
    const d = new Date();
    d.setTime(d.getTime() + (exsecs*1000));
    let expires = "expires="+ d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function funcDeleteCookie(cname) {
    let expires = "expires=Thu, 01 Jan 1970 00:00:00 UTC";
    document.cookie = cname + "=a" + ";" + expires + ";path=/";
}    

function funcGetCookie(cname) {
    let name = cname + "=";
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(';');
    for(let i = 0; i <ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}    


Date.prototype.addSecs = function (s) {
    this.setTime(this.getTime() + (s * 1000));
    return this;
}

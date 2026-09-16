$(function () {
    $("[data-toggle='tooltip']").tooltip();
});

function funcOnLoad() {
    setTimeout(showTimeOnAdminPanel, 1);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const toggleIcon = document.getElementById('toggle-icon');
    
    sidebar.classList.toggle('sidebar-collapse');
    mainContent.classList.toggle('collapsed-main');
    
    if (sidebar.classList.contains('sidebar-collapse')) {
        toggleIcon.classList.remove('fa-angle-left');
        toggleIcon.classList.add('fa-angle-right');
    } else {
        toggleIcon.classList.remove('fa-angle-right');
        toggleIcon.classList.add('fa-angle-left');
    }
}


async function changeUserBotOnOff(id, status) {
    var endPoint = `${window.SERVER_ENDPOINT}/admin/bot_onoff_change/`

    var paramPayload= {
        'id':id,
        'status':status
    }
    console.log(paramPayload);
    const response = await fetch(endPoint, {
        method: "POST",
        mode:'no-cors',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(paramPayload),
    });
    console.log(response)
}

async function changeAllowStatus(user_id, status) {
    var endPoint = `${window.SERVER_ENDPOINT}/admin/user_allow_status_change/`

    var paramPayload= {
        'user_id':user_id,
        'status':status
    }
    console.log(paramPayload);
    const response = await fetch(endPoint, {
        method: "POST",
        mode:'no-cors',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(paramPayload),
    });
    console.log(response)
}


async function changePwdAllowStatus(user_id, allow_by_admin) {
    var endPoint = `${window.SERVER_ENDPOINT}/admin/user_pwd_allow_change/`

    var paramPayload= {
        'user_id':user_id,
        'allow_by_admin':allow_by_admin
    }
    console.log(paramPayload);
    const response = await fetch(endPoint, {
        method: "POST",
        mode:'no-cors',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(paramPayload),
    });
    console.log(response)
}


async function changeAllowDescription(user_id, text_id) {
    description = document.getElementById(text_id).value
    var endPoint = `${window.SERVER_ENDPOINT}/admin/user_allow_description_change/`

    var paramPayload= {
        'user_id':user_id,
        'description':description
    }
    console.log(paramPayload);
    const response = await fetch(endPoint, {
        method: "POST",
        mode:'no-cors',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(paramPayload),
    });
    console.log(response)
}



async function submitBotRunSetting() {
    // Get form data
    const vix_selected_mode = document.getElementById('select_vix_gap_mode').value
    const paramPayload = {
        vix_automatic_mode:  vix_selected_mode == "Automatic" ? true : false,
        vix_gap_lower: document.getElementById('input_vix_gap_lower').checked,
        vix_gap_up: document.getElementById('input_vix_gap_up').checked,
        order_gap_sec: document.getElementById('input_order_gap_second').value,
    };
    
    var endPoint = `${window.SERVER_ENDPOINT}/admin/bot_run_setting_submit/`
    const response = await fetch(endPoint, {
        method: "POST",
        mode:'no-cors',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(paramPayload),
    });
    if (response.ok) {
        alert("Successfully applied.")
    }
    else {
        alert("Error in submitting the run setting.")
        console.log(response)
    }
}


async function showTimeOnAdminPanel() {
    let now = new Date();
    const formattedDate = now.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'long',   // "May" (full month name)
        day: '2-digit',  // "05" (zero-padded)
        year: 'numeric', // "2025"
        hour: '2-digit', // "06" (12-hour format by default)
        minute: '2-digit', // "34"
        second:'2-digit',
        hour12: false    // Use 24-hour format (optional)
    });
    var eleTimePanel = document.getElementById("p_time_panel")
    if (eleTimePanel != null) {
        eleTimePanel.innerHTML = `EST ${formattedDate}`;
        setTimeout(showTimeOnAdminPanel, 1);
    }
}
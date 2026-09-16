function funcOnLoad() {
}

async function changePasword() {
    // Get form data
    const paramPayload = {
        new_password: document.getElementById('input_new_password').value,
        confirm_password: document.getElementById('input_confirm_password').value,
    };
    
    var endPoint = `${window.SERVER_ENDPOINT}/change_password/`
    const response = await fetch(endPoint, {
        method: "POST",
        mode:'no-cors',
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(paramPayload),
    });
    if (response.ok) {
        alert("Password changed successfuly.")
    }
    else {
        data = await response.json()
        alert(data['error'])
    }
}

const socket = io()

// Elements
const $boardContainer = document.querySelector("#board-container")
const $messages = document.querySelector('#messages')

const $clueForm = document.querySelector('#clue-form')
const $clueFormInput = $clueForm.querySelectorAll('input')
const $clueFormButton = $clueForm.querySelector('button')

// Templates
const messageTemplate = document.querySelector('#message-template').innerHTML

// Options
const { username, lobbyName } = Qs.parse(location.search, { ignoreQueryPrefix: true })

let currentGuesses = -1
let guessEnabled = false


// Calls current board from database and displays
// Can be made into an import
const generateBoard = async (boardId) => {
    clearBoard()
    const response = await fetch(`/boards/wordlist/${boardId}`)
    const data = await response.json()

    // Saves startTeam in session storage
    sessionStorage.setItem('startTeam', data.startTeam)

    // Adds a card for each word to html
    data.wordlist.forEach((word) => {
        const node = document.createElement('div')
        node.className = "card"
        node.id = `${word}-card-id`
        node.setAttribute(`revealed`, 'false')
        node.innerHTML = `<div class='card-word'><span>${word}</span></div>`
        $boardContainer.appendChild(node)
    });

    $('.card').on('click', function () {
        const element = $(this)
        if (element.attr('revealed') === 'false' && guessEnabled) {
            guessEnabled = false
            cardEvent(element.text())
        }
    })
}


// Adds team colors to cards
// Can be made into an import
// Might need cleanup due to limited usage
const addBoardOverlay = async (boardId) => {
    const response = await fetch(`/boards/overlay/${boardId}`)
    const data = await response.json()

    const $boardCards = $boardContainer.querySelectorAll('.card')

    $boardCards.forEach((card, i) => {
        card.classList.add(`${data.overlay[i]}-card`)
    })

}


// Removes board from HTML
// Can be made into an import
// Doesn't remove from database or change boardId in session Storage
const clearBoard = () => { $boardContainer.innerHTML = '' }


// Creates a new board and returns it
// Can be made into an import
const newBoard = async (gameId) => {
    const boardRaw = await fetch(`/boards`, { method: 'POST', headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gameId }) })
    const board = await boardRaw.json()
    return board
}

// Creates and returns a new game and board
// Can be made into an import
const newGame = async (lobbyName) => {
    // Creates new game 'lobbyName'
    const gameRaw = await fetch(`/games`, { method: 'POST', headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lobbyName }) })
    const game = await gameRaw.json()

    const board = await newBoard(game._id)

    return { game, board }
}


// Gets and Returns existing game and board or returns newGame
// Can be made into an import
const getGameData = async (lobbyName) => {
    // Looks for game with name 'lobbyName'
    const gameRaw = await fetch(`/games/lobby/${lobbyName}`)
    const game = await gameRaw.json()

    // If there is game 'lobbyName' in database returns a new game, 
    // else gets current game board and returns the game with the board
    if (game.msg === 'no game found') {
        return newGame(lobbyName)
    } 
    else {
        const boardRaw = await fetch(`/boards/game/${game._id}`)
        const board = await boardRaw.json()

        return { game, board }
    }
}


// Starting function
const joinGame = async (username, lobbyName) => {
    // Gets game with name 'lobbyName' and its current board or if none found creates a new game with that name
    const { game, board } = await getGameData(lobbyName)
    const gameId = game._id
    // Stores gameId in session storage
    sessionStorage.setItem('gameId', gameId)

    // Sends socket call to server for new player, returns them to home page if name was already taken
    // Should refactor code to prevent entry altogether eventually
    // Would require html changes to start
    socket.emit('join', { playerName: username, gameId }, ({ error, player }) => {
        if (error) {
            alert(error)
            location.href = '/'
            return
        } else {
            // Writes username and playerId into session storage if playname was accepted
            sessionStorage.setItem('username', player.username)
            sessionStorage.setItem('playerId', player._id)
        }
    })

    displaysSetup(board._id)
}

// Displays current board, starting team, and adjusts score counter
const displaysSetup = async (boardId) => {
    // Current board Id written into session storage
    sessionStorage.setItem('boardId', boardId)

    // Gets board and displays it to user
    await generateBoard(boardId)

    // Add 1 to cards remaining for starting team
    const startTeam = sessionStorage.getItem('startTeam')
    const $counter = document.querySelector(`#${startTeam}-team-counter`)
    $counter.innerText = parseInt($counter.innerText) + 1
}


// Chat App functions

const autoscroll = () => {
    // New message element
    const $newMessage = $messages.lastElementChild

    // Height of new message
    const newMessageStyles = getComputedStyle($newMessage)
    const newMessageMargin = parseInt(newMessageStyles.marginBottom)
    const newMessageHeight = $newMessage.offsetHeight + newMessageMargin

    // Visible height
    const visibleHeight = $messages.offsetHeight

    // Height of messages container
    const containerHeight = $messages.scrollHeight

    // How far have I scrolled?
    const scrollOffset = $messages.scrollTop + visibleHeight

    if (containerHeight - newMessageHeight <= scrollOffset) {
        $messages.scrollTop = $messages.scrollHeight
    }
}

socket.on('message', ({ text, team, type = ''}) => {
    const html = Mustache.render(messageTemplate, { text, team, type})
    $messages.insertAdjacentHTML('beforeend', html)
    autoscroll()
})


// Role Assignment

// Handles join team buttons, Gives user a role and a team, Adjusts display accordingly
const joinTeamEvent = async (e) => {
        const role = e.target.getAttribute('role')
        const team = e.target.getAttribute('team')
        const startTeam = sessionStorage.getItem('startTeam')

        $('.team-join-btn').prop('disabled', true)

        // changes player info in database
        const changes = { 'role': role, 'team': team }
        const playerId = sessionStorage.getItem('playerId')
        const response = await fetch(`/players/${playerId}`, { method: 'PATCH', headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) })
        const player = await response.json()

        // Changes display to give card overlay and give clue form if they become a spymaster
        if (player.role === 'spymaster') {
            const boardId = sessionStorage.getItem('boardId')
            addBoardOverlay(boardId, player.role)
            $clueForm.style.display = 'block'
            if (player.team === startTeam) {
                socket.emit('updateActivePlayer', { playerName: player.username, team: player.team, role: player.role, gameId: player.gameId })
            }

        }

        socket.emit('new-role', { role, team, playerId })
}

$('.team-join-btn').on('click', function (e) {joinTeamEvent(e)})


// Recieves claimed roles and adjusts user's display to show username in place of button
socket.on('new-player-role', ({ role, team, username }) => {
    const wrapper = document.querySelector(`#${role}-${team}-wrapper`)
    wrapper.innerHTML = `<p class='role-username card-word'> ${username} </p>`

})

socket.on('reset-player-role', async ({ role, team }) => {
    if (team !== 'civilian') {
        $(`#${role}-${team}-wrapper`).innerHTML = `<button team='${team}' role='${role}' class="team-join-btn">Join</button>`
    }

    const playerId = sessionStorage.getItem('playerId')
    const playerRaw = await fetch(`/players/${playerId}`)
    const player = await playerRaw.json()

    if(player.team !== '' ){
        $(`#${role}-${team}-wrapper`).prop('disabled', true)
    }

})

// Game Events

// Event cards are given
const cardEvent = async (word) => {
    const boardId = sessionStorage.getItem('boardId')

    const playerId = sessionStorage.getItem('playerId')
    const playerRaw = await fetch(`/players/${playerId}`)
    const player = await playerRaw.json()

    // Reveals card team to all players and checks if card belongs to user's team 
    socket.emit('handleGuess', { word, guessNumber: currentGuesses, boardId, player }, (yourTurn) => {
        // Ends turn if out of guesses or bad guess
        if (yourTurn === false) {
            currentGuesses = -1
            socket.emit('cluePhase', { team })
            $('.end-turn-btn').prop('disabled', true)
        } else {
            currentGuesses -= 1
            guessEnabled = true
        }
    })
}

// Sends clue to other players through chat message, changes game state to guessing phase
$clueForm.addEventListener('submit', (e) => {
    e.preventDefault()

    $clueFormButton.setAttribute('disabled', 'disabled')

    const clue = e.target.elements.clue.value
    const guessNumber = e.target.elements.guessNumber.value
    const playerId = sessionStorage.getItem('playerId')

    socket.emit('sendClue', { clue, guessNumber, playerId }, (error) => {
        $clueForm.reset()

        if (error) {
            return console.log(error)
        }
    })
})


// Allows guessers to make guesses by clicking on cards
socket.on('guessingPhase', async ({ guessNumber, team }) => {
    const playerId = sessionStorage.getItem('playerId')
    const playerRaw = await fetch(`/players/${playerId}`)
    const player = await playerRaw.json()

    // Checks if it's this user's turn
    if (player.role === 'guesser' && player.team === team) {
        currentGuesses = guessNumber
        guessEnabled = true
        $('.end-turn-btn').prop('disabled', false)
        const message = `It is ${player.username}'s turn to guess`
        socket.emit('sendMessage', { message, team: player.team, gameId: player.gameId })
        socket.emit('updateActivePlayer', { playerName: player.username, team: player.team, role: player.role, gameId: player.gameId })
    }
})

// Unlocks clueform for next spymaster
socket.on('spymasterPhase', async ({ activeTeam }) => {
    const playerId = sessionStorage.getItem('playerId')
    const playerRaw = await fetch(`/players/${playerId}`)
    const player = await playerRaw.json()

    if (player.role === 'spymaster' && player.team === activeTeam) {
        $clueFormButton.removeAttribute('disabled')
        const message = `It is ${player.username}'s turn to give a clue.`
        socket.emit('sendMessage', { message, team: player.team, gameId: player.gameId })
        socket.emit('updateActivePlayer', { playerName: player.username, team: player.team, role: player.role, gameId: player.gameId })

    }
})

// Changes css on revealed cards
socket.on('card-reveal', ({ cardTeam, word }) => {
    const card = document.querySelector(`#${word}-card-id`)
    card.classList.add(`${cardTeam}-card`)
    card.setAttribute(`revealed`, 'true')
})


// Updates cards remaining in teambox on card reveal
socket.on('update-score', ({ cardTeam }) => {
    const $counter = document.querySelector(`#${cardTeam}-team-counter`)
    $counter.innerText = parseInt($counter.innerText) - 1

    if ($counter.innerText === '0') {
        //WIN
        teamVictory(cardTeam)
    }
})

socket.on('assassin-game-over', ({ opposingTeam }) => {
    teamVictory(opposingTeam)
})

const teamVictory = (team) => {
    const boardId = sessionStorage.getItem('boardId')
    addBoardOverlay(boardId)

    const msg = `The ${team} team wins!`
    $('.victory-msg').text(msg)
    $('#victory-menu').css("display", "grid")
    $("#game-status-box").css("display", "none")
}

$('.leave-game-btn').on('click', () => {
    const playerId = sessionStorage.getItem('playerId')
    socket.emit('leave-game', { playerId })
    location.href = '/'
})


// Changes text in game status box
socket.on('updateGameStatusClue', ({guessNumber, clue=''}) => {
    $(`#current-guessNumber`).text(guessNumber)
    if (clue !== ''){
        $(`#current-clue`).text(clue)
    }
})

socket.on('updateGameStatusPlayer', ({playerName, team, role}) => {
        let message = ''
        if (role === 'spymaster'){
            message = `It's ${playerName}'s turn to send a clue.`
        } 
        else {
            message = `It's ${playerName}'s turn to guess.`
        }
        $(`#current-playerName`).text(message)
        $(`#current-playerName`).css('background-color', `var(--${team}-team-color`)
})

socket.on('revealGameStatus', () => {
    $("#game-status-box").css("display", "grid")
    $("#start-menu").css("display", "none")
})

$('#start-btn').on('click', () => {
    const gameId = sessionStorage.getItem('gameId')
    const startTeam = sessionStorage.getItem('startTeam')
    socket.emit('startGame', {gameId, startTeam})
})

$('#new-game-btn').on('click', () => {
    const gameId = sessionStorage.getItem('gameId')
    // Clears player roles and deletes old board
    socket.emit('clear-board', {gameId})
    newBoard(gameId)
    socket.emit('send-restart', {gameId})
})

$('.end-turn-btn').on('click', async() => {
    const playerId = sessionStorage.getItem('playerId')
    const playerRaw = await fetch(`/players/${playerId}`)
    const player = await playerRaw.json()

    currentGuesses = -1
    guessEnabled = false
    activeTeam = player.team === 'red' ? 'blue' : 'red'

    socket.emit('sendMessage',{ message: `${player.team}'s turn is over.`, team: player.team, gameId: player.gameId})
    socket.emit('updateClue', { gameId: player.gameId })
    socket.emit('end-turn', { activeTeam, gameId: player.gameId })
    $('.end-turn-btn').prop('disabled', true)
})

socket.on('new-round', async ({gameId}) => {
    
    //Removing player roles and teams
    const changes = { 'role': 'guesser', 'team': 'civilian' }
    const playerId = sessionStorage.getItem('playerId')
    const response = await fetch(`/players/${playerId}`, { method: 'PATCH', headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) })

    $clueForm.style.display = 'none'
    $('.counter').text('8')

    $('.team-join-btn').on('click', function (e) {joinTeamEvent(e)})

    const boardRaw = await fetch(`/boards/game/${gameId}`)
    const board = await boardRaw.json()
    displaysSetup(board._id)

    $messages.innerHTML = ''

    $("#start-menu").css("display", "grid")
    $('#victory-menu').css("display", "none")
})


joinGame(username, lobbyName)
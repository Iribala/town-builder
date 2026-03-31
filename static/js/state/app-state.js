const appState = {
    myName: '',
    selectedObject: null,
    drivingCar: null,
    pendingPlacementModelDetails: null,
    // Town information
    currentTownId: null,
    currentTownName: null,
    currentTownDescription: null,
    currentTownLatitude: null,
    currentTownLongitude: null,
    currentTownPopulation: null,
    currentTownArea: null,
    currentTownEstablishedDate: null,
    currentTownPlaceType: null,
    currentTownFullAddress: null,
    currentTownImage: null,
    // WASM and timing
    wasmReady: false,
    deltaTime: 0,
    elapsedTime: 0,
    // Base path and token
    basePath: '',
    token: null,
    // Environment map
    envMapTexture: null
};

export function getMyName() {
    return appState.myName;
}

export function setMyName(name) {
    appState.myName = name || '';
}

export function getSelectedObject() {
    return appState.selectedObject;
}

export function setSelectedObject(object) {
    appState.selectedObject = object;
}

export function getDrivingCar() {
    return appState.drivingCar;
}

export function setDrivingCar(car) {
    appState.drivingCar = car;
}

export function getPendingPlacementModelDetails() {
    return appState.pendingPlacementModelDetails;
}

export function setPendingPlacementModelDetails(details) {
    appState.pendingPlacementModelDetails = details;
}

// Town information getters and setters
export function getCurrentTownId() {
    return appState.currentTownId;
}

export function setCurrentTownId(townId) {
    appState.currentTownId = townId;
}

export function getCurrentTownName() {
    return appState.currentTownName;
}

export function setCurrentTownName(name) {
    appState.currentTownName = name;
}

export function getCurrentTownDescription() {
    return appState.currentTownDescription;
}

export function setCurrentTownDescription(description) {
    appState.currentTownDescription = description;
}

export function getCurrentTownLatitude() {
    return appState.currentTownLatitude;
}

export function setCurrentTownLatitude(latitude) {
    appState.currentTownLatitude = latitude;
}

export function getCurrentTownLongitude() {
    return appState.currentTownLongitude;
}

export function setCurrentTownLongitude(longitude) {
    appState.currentTownLongitude = longitude;
}

export function getCurrentTownPopulation() {
    return appState.currentTownPopulation;
}

export function setCurrentTownPopulation(population) {
    appState.currentTownPopulation = population;
}

export function getCurrentTownArea() {
    return appState.currentTownArea;
}

export function setCurrentTownArea(area) {
    appState.currentTownArea = area;
}

export function getCurrentTownEstablishedDate() {
    return appState.currentTownEstablishedDate;
}

export function setCurrentTownEstablishedDate(date) {
    appState.currentTownEstablishedDate = date;
}

export function getCurrentTownPlaceType() {
    return appState.currentTownPlaceType;
}

export function setCurrentTownPlaceType(placeType) {
    appState.currentTownPlaceType = placeType;
}

export function getCurrentTownFullAddress() {
    return appState.currentTownFullAddress;
}

export function setCurrentTownFullAddress(address) {
    appState.currentTownFullAddress = address;
}

export function getCurrentTownImage() {
    return appState.currentTownImage;
}

export function setCurrentTownImage(image) {
    appState.currentTownImage = image;
}

// WASM and timing getters and setters
export function isWasmReady() {
    return appState.wasmReady;
}

export function setWasmReady(ready) {
    appState.wasmReady = ready;
}

export function getDeltaTime() {
    return appState.deltaTime;
}

export function setDeltaTime(deltaTime) {
    appState.deltaTime = deltaTime;
}

export function getElapsedTime() {
    return appState.elapsedTime;
}

export function setElapsedTime(elapsedTime) {
    appState.elapsedTime = elapsedTime;
}

// Base path and token getters and setters
export function getBasePath() {
    return appState.basePath;
}

export function setBasePath(path) {
    appState.basePath = path || '';
}

export function getToken() {
    return appState.token;
}

export function setToken(token) {
    appState.token = token;
}

// Environment map getters and setters
export function getEnvMapTexture() {
    return appState.envMapTexture;
}

export function setEnvMapTexture(texture) {
    appState.envMapTexture = texture;
}

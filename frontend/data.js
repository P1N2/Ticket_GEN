// Initialisation de la base de données locale
const EventDB = {
    // Récupérer tous les événements
    getAll: function() {
        const data = localStorage.getItem('event_manager_data');
        return data ? JSON.parse(data) : [];
    },

    // Sauvegarder la liste complète
    saveAll: function(events) {
        localStorage.setItem('event_manager_data', JSON.stringify(events));
    },

    // Ajouter un nouvel événement
    addEvent: function(newEvent) {
        const events = this.getAll();
        events.push(newEvent);
        this.saveAll(events);
    },

    // Récupérer un événement spécifique par ID
    getById: function(id) {
        const events = this.getAll();
        return events.find(e => e.id == id);
    },

    // Ajouter un ticket à un événement
    addTicket: function(eventId, ticket) {
        const events = this.getAll();
        const index = events.findIndex(e => e.id == eventId);
        if (index !== -1) {
            events[index].tickets.push(ticket);
            this.saveAll(events);
        }
    }
};
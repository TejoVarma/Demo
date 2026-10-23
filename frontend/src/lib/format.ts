const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export const formatPrice = (amount: number) => rupees.format(amount)

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Reservation;
use Illuminate\Http\Request;

class ReservationController extends Controller
{
    public function index()
    {
        return response()->json(Reservation::with(['restaurant', 'table'])->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'table_id' => ['nullable', $this->restaurantResourceRule('tables', $request)],
            'customer_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
            'reservation_date' => ['required', 'date'],
            'guests' => ['required', 'integer', 'min:1'],
            'status' => ['nullable', 'string', 'max:50'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $reservation = Reservation::create($validated);

        return response()->json($reservation, 201);
    }

    public function show(Reservation $reservation)
    {
        return response()->json($reservation->load(['restaurant', 'table']));
    }

    public function update(Request $request, Reservation $reservation)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'table_id' => ['nullable', $this->restaurantResourceRule('tables', $request)],
            'customer_name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
            'reservation_date' => ['sometimes', 'date'],
            'guests' => ['sometimes', 'integer', 'min:1'],
            'status' => ['nullable', 'string', 'max:50'],
        ]);

        $reservation->update($validated);

        return response()->json($reservation);
    }

    public function destroy(Reservation $reservation)
    {
        $reservation->delete();

        return response()->json(null, 204);
    }
}

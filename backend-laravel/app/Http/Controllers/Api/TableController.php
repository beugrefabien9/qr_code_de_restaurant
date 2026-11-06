<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Table;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TableController extends Controller
{
    private function serializeTable(Table $table): array
    {
        return [
            'id' => $table->id,
            'restaurant_id' => $table->restaurant_id,
            'restaurant' => $table->restaurant_id,
            'restaurant_name' => $table->restaurant?->name,
            'number' => $table->number,
            'capacity' => $table->capacity,
            'status' => $table->status === 'available' ? 'free' : $table->status,
            'qr_code' => $table->qr_token,
            'created_at' => $table->created_at,
            'updated_at' => $table->updated_at,
        ];
    }

    private function normalizeStatus(?string $status): ?string
    {
        return $status === 'free' ? 'available' : $status;
    }

    public function index()
    {
        return response()->json(Table::with('restaurant')->get()->map(
            fn (Table $table) => $this->serializeTable($table),
        ));
    }

    public function store(Request $request)
    {
        $restaurantId = $request->user()->restaurant_id ?? $request->input('restaurant_id');
        $numberRule = Rule::unique('tables', 'number');
        if ($restaurantId) {
            $numberRule->where('restaurant_id', $restaurantId);
        }

        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'number' => [
                'required',
                'integer',
                $numberRule,
            ],
            'capacity' => ['required', 'integer', 'min:1'],
            'status' => ['sometimes', 'required', 'in:free,available,occupied,reserved,unavailable'],
        ]);

        $validated = $this->assignRestaurant($validated, $request);
        $validated['status'] = $this->normalizeStatus($validated['status'] ?? 'available');
        $table = Table::create($validated);

        return response()->json($this->serializeTable($table->load('restaurant')), 201);
    }

    public function show(Table $table)
    {
        return response()->json($this->serializeTable($table->load('restaurant')));
    }

    public function update(Request $request, Table $table)
    {
        $restaurantId = $request->user()->restaurant_id ?? $request->input('restaurant_id', $table->restaurant_id);
        $numberRule = Rule::unique('tables', 'number')->ignore($table->id);
        if ($restaurantId) {
            $numberRule->where('restaurant_id', $restaurantId);
        }

        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'number' => [
                'sometimes',
                'integer',
                $numberRule,
            ],
            'capacity' => ['sometimes', 'integer', 'min:1'],
            'status' => ['sometimes', 'required', 'in:free,available,occupied,reserved,unavailable'],
        ]);

        if (array_key_exists('status', $validated)) {
            $validated['status'] = $this->normalizeStatus($validated['status']);
        }

        $table->update($validated);

        return response()->json($this->serializeTable($table->fresh('restaurant')));
    }

    public function destroy(Table $table)
    {
        $table->delete();

        return response()->json(null, 204);
    }
}
